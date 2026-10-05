import { randomUUID } from 'node:crypto';
import { computeRealizedFromSales } from '@portfolio-dashboard/shared';
import { SYMBOLS } from '../config/symbols';
import { all, get, run } from '../db';
import { refreshPrices } from './priceFetcher';
import { replayFIFOLots, computePortfolioValue } from './portfolioCalculator';

export async function computeAndInsertHistoryPoint(options: { manual?: boolean; note?: string } = {}) {
  await refreshPrices();

  const priceRows: any[] = await all('SELECT symbol, price FROM price_cache');
  const prices: Record<string, number> = {};
  for (const r of priceRows) prices[r.symbol] = r.price;

  const trades: any[] = await all('SELECT * FROM trades ORDER BY time ASC');
  const lots = replayFIFOLots(trades, prices);
  const realizedFromSells = computeRealizedFromSales(trades, SYMBOLS, prices['BRLUSD'] ?? 1, prices).totalUsd;

  const cashRow: any = await get(`
    SELECT
      COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
      COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
    FROM cash
  `);
  const cash = {
    cashReais: cashRow?.cashReais ?? 0,
    cashDollars: cashRow?.cashDollars ?? 0,
  };

  const brlMonths: any[] = await all("SELECT amount FROM interest WHERE currency = 'BRL'");
  const usdMonths: any[] = await all("SELECT amount FROM interest WHERE currency = 'USD'");
  const interestBRLMonthsTotal = brlMonths.reduce((s, m) => s + (m.amount || 0), 0);
  const interestUSDMonthsTotal = usdMonths.reduce((s, m) => s + (m.amount || 0), 0);

  const { total, investedNet, p, brlUsdRate } = computePortfolioValue({
    lots,
    prices,
    cash,
    realizedFromSells,
    interestBRLMonthsTotal,
    interestUSDMonthsTotal,
  });

  const last: any = await get('SELECT * FROM portfolio_snapshots ORDER BY ts DESC LIMIT 1');
  const now = Date.now();
  if (!options.manual && last && now - (last.ts || 0) < 25 * 60 * 1000) {
    console.log('Skipping scheduled history insertion; recent point exists', last.ts);
    return last;
  }

  const id = randomUUID();
  const ts = now;
  const t = new Date(ts).toISOString();
  await run(
    'INSERT INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note, brlusd_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, t, ts, total, investedNet, p, options.manual ? 1 : 0, options.note ?? null, brlUsdRate],
  );
  return await get('SELECT * FROM portfolio_snapshots WHERE id = ?', [id]);
}

export async function recomputeHistoryAt(ts: number) {
  const cutoff = new Date(ts).toISOString();
  const trades: any[] = await all('SELECT * FROM trades WHERE time <= ? ORDER BY time ASC', [cutoff]);

  const lots = replayFIFOLots(trades, {});

  const tickRows: any[] = await all(
    `
    SELECT p.symbol, p.price
    FROM price_ticks p
    INNER JOIN (
      SELECT symbol, MAX(ts) AS max_ts
      FROM price_ticks
      WHERE ts <= ?
      GROUP BY symbol
    ) latest ON p.symbol = latest.symbol AND p.ts = latest.max_ts
  `,
    [ts],
  );

  if (tickRows.length === 0) {
    throw new Error(`No price_ticks data at or before ts=${ts}. Run npm run migrate:backfill-prices first.`);
  }

  const prices: Record<string, number> = {};
  for (const r of tickRows) prices[r.symbol] = r.price;

  const cashRow: any = await get(
    `
    SELECT
      COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
      COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
    FROM cash
    WHERE ts <= ?
  `,
    [ts],
  );
  const cash = {
    cashReais: cashRow?.cashReais ?? 0,
    cashDollars: cashRow?.cashDollars ?? 0,
  };

  const brlMonthsAt: any[] = await all("SELECT amount FROM interest WHERE currency = 'BRL' AND created_at <= ?", [ts]);
  const usdMonthsAt: any[] = await all("SELECT amount FROM interest WHERE currency = 'USD' AND created_at <= ?", [ts]);
  const interestBRLMonthsTotal = brlMonthsAt.reduce((s, m) => s + (m.amount || 0), 0);
  const interestUSDMonthsTotal = usdMonthsAt.reduce((s, m) => s + (m.amount || 0), 0);

  const { total, investedNet, p, brlUsdRate } = computePortfolioValue({
    lots,
    prices,
    cash,
    realizedFromSells: computeRealizedFromSales(trades, SYMBOLS, prices['BRLUSD'] ?? 1, prices).totalUsd,
    interestBRLMonthsTotal,
    interestUSDMonthsTotal,
  });

  return {
    t: new Date(ts).toISOString(),
    ts,
    v: total,
    i: investedNet,
    p,
    brlusd_rate: brlUsdRate,
  };
}
