import { Router, Request, Response } from 'express';
import { run, all } from '../db';
import { SYMBOLS } from '../config/symbols';
import { sampleEvenly, computeCashEstimates, estimatesToDeltas } from '../services/cashBackfill';
import { randomUUID } from 'node:crypto';

export const migrationsRouter = Router();

// Fetches ~2yr daily closes from Yahoo Finance into price_ticks.
// Warning: makes external HTTP calls with 800ms sleep per symbol (~30s total).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface YahooPoint {
  ts: number;
  price: number;
}

async function fetchYahooHistory(ticker: string, fromMs: number, toMs: number): Promise<YahooPoint[]> {
  const period1 = Math.floor(fromMs / 1000);
  const period2 = Math.floor(toMs / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${ticker}`);
  const data = (await res.json()) as any;
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart result for ${ticker}`);
  const timestamps: number[] = result.timestamp ?? [];
  const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
  const points: YahooPoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = closes[i];
    if (typeof price === 'number' && isFinite(price) && price > 0) {
      points.push({ ts: timestamps[i] * 1000, price });
    }
  }
  return points;
}

migrationsRouter.post('/backfill-prices', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60 * 1000;
    const results: { symbol: string; inserted: number; fetched: number; status: string }[] = [];
    let totalInserted = 0;

    for (const [symbolId, config] of Object.entries(SYMBOLS)) {
      const tickers = config.historicalFallbacks ?? (config.yahooTicker ? [config.yahooTicker] : []);
      if (tickers.length === 0) {
        results.push({ symbol: symbolId, inserted: 0, fetched: 0, status: 'skip:no-ticker' });
        continue;
      }

      let points: YahooPoint[] = [];
      let succeeded = false;

      for (const ticker of tickers) {
        try {
          points = await fetchYahooHistory(ticker, twoYearsAgo, now);
          if (points.length > 0) {
            succeeded = true;
            break;
          }
        } catch (_e) {
          /* try next ticker */
        }
      }

      if (!succeeded || points.length === 0) {
        results.push({ symbol: symbolId, inserted: 0, fetched: 0, status: 'fail:no-data' });
        await sleep(800);
        continue;
      }

      const needsInversion = symbolId === 'BRLUSD';
      const before = await all<{ n: number }>('SELECT COUNT(*) AS n FROM price_ticks WHERE symbol = ?', [symbolId]);
      const beforeCount = before[0]?.n ?? 0;

      for (const pt of points) {
        const price = needsInversion ? 1 / pt.price : pt.price;
        if (!isFinite(price) || price <= 0) continue;
        await run('INSERT OR IGNORE INTO price_ticks (id, symbol, price, ts, source) VALUES (?, ?, ?, ?, ?)', [
          randomUUID(),
          symbolId,
          price,
          pt.ts,
          'yahoo_historical',
        ]);
      }

      const after = await all<{ n: number }>('SELECT COUNT(*) AS n FROM price_ticks WHERE symbol = ?', [symbolId]);
      const inserted = (after[0]?.n ?? 0) - beforeCount;
      totalInserted += inserted;
      results.push({ symbol: symbolId, inserted, fetched: points.length, status: 'ok' });
      await sleep(800);
    }

    res.json({ ok: true, results, totalInserted });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// from each snapshot's total value.  Clears ALL existing cash entries first,
// then inserts signed BRL deltas so that SUM(cash WHERE ts<=T) reproduces the
// estimated balance at any past timestamp.

migrationsRouter.post('/backfill-cash', async (_req: Request, res: Response) => {
  try {
    const snapshots: any[] = await all('SELECT ts, v, brlusd_rate FROM portfolio_snapshots WHERE v IS NOT NULL ORDER BY ts ASC');
    if (snapshots.length === 0) {
      return res.json({ ok: false, error: 'No portfolio snapshots found.' });
    }

    const allTrades: any[] = await all('SELECT * FROM trades ORDER BY time ASC');
    const sampled = sampleEvenly(snapshots, 30);

    const priceCache = new Map<number, Record<string, number>>();
    for (const snap of sampled) {
      const tickRows: any[] = await all(
        `SELECT p.symbol, p.price
         FROM price_ticks p
         INNER JOIN (
           SELECT symbol, MAX(ts) AS max_ts
           FROM price_ticks
           WHERE ts <= ?
           GROUP BY symbol
         ) latest ON p.symbol = latest.symbol AND p.ts = latest.max_ts`,
        [snap.ts],
      );
      const prices: Record<string, number> = {};
      for (const r of tickRows) prices[r.symbol] = r.price;
      priceCache.set(snap.ts, prices);
    }

    const estimates = computeCashEstimates(sampled, allTrades, (ts) => priceCache.get(ts) ?? {});

    if (estimates.length === 0) {
      return res.json({
        ok: false,
        error: 'Could not derive any cash estimates — price_ticks may be empty. Run backfill-prices first.',
      });
    }

    const deltas = estimatesToDeltas(estimates);

    await run('DELETE FROM cash');
    for (const d of deltas) {
      await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
        randomUUID(),
        'BRL',
        d.amount,
        'Cash backfill estimate',
        d.ts,
      ]);
    }

    res.json({
      ok: true,
      snapshotsTotal: snapshots.length,
      sampled: sampled.length,
      estimated: estimates.length,
      inserted: deltas.length,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
