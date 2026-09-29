/**
 * `GET /api/portfolio/valuation` — the portfolio's derived values, computed
 * server-side.
 *
 * Phase 6 of docs/MODERNIZATION-PLAN.md. Until then the dashboard recomputed
 * invested cost, totals, BRL conversion, per-position P/L and the allocation
 * split in the browser, from a second copy of the rules that `historyManager`
 * and `analyticsService` already apply when they write snapshots. Two copies of
 * one rule drift: the live dashboard and the chart behind it could disagree
 * about the same portfolio, and nothing would fail.
 *
 * The maths is `computeValuation` from `@portfolio-dashboard/shared` — the same
 * function the browser calls when it has to value something the server cannot
 * know about yet (the simulator's what-if prices). The route's job is to gather
 * the inputs the database already holds and hand them over.
 */
import { Router, Request, Response } from 'express';
import { all, get } from '../db';
import { SYMBOLS } from '../config/symbols';
import { computeValuation, computeRealizedFromSales, type ValuationInput } from '@portfolio-dashboard/shared';

export const portfolioRouter = Router();

const CASH_SUM_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
    COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
  FROM cash
`;

interface PriceRow {
  symbol: string;
  price: number;
  meta?: string | null;
}

/** `price_cache.meta` holds `{ priceBRL }` for symbols quoted in BRL. */
function parsePriceMeta(raw: string | null | undefined): { priceBRL?: number } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { priceBRL?: number };
    return typeof parsed?.priceBRL === 'number' ? { priceBRL: parsed.priceBRL } : undefined;
  } catch {
    // A malformed cache entry is a price-fetch problem, not a request failure:
    // the symbol still has its USD price, and the bond row falls back to that.
    return undefined;
  }
}

portfolioRouter.get('/valuation', async (req: Request, res: Response) => {
  try {
    // Which split the allocation chart is showing. Defaults to the dashboard's
    // own default; the view refetches when the user flips the toggle rather than
    // receiving both variants, so the percentages and the request cannot drift.
    const includeCashInAllocation = req.query.cash !== 'investments';

    const [trades, priceRows, cash, brlInterest, usdInterest] = await Promise.all([
      // `ORDER BY time ASC` is load-bearing, not tidiness: the FIFO walk that
      // derives realized P/L below is only correct over trades in the order they
      // happened, and on this database rowid order is *not* that order.
      all<{ symbol: string; side: string; qty: number; price: number | null }>(
        'SELECT symbol, side, qty, price FROM trades ORDER BY time ASC',
      ),
      all<PriceRow>('SELECT symbol, price, meta FROM price_cache'),
      get<{ cashReais: number; cashDollars: number }>(CASH_SUM_SQL),
      get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['BRL']),
      get<{ total: number }>('SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?', ['USD']),
    ]);

    const prices: Record<string, number> = {};
    const priceMeta: Record<string, { priceBRL?: number }> = {};
    for (const row of priceRows) {
      prices[row.symbol] = row.price;
      const meta = parsePriceMeta(row.meta);
      if (meta) priceMeta[row.symbol] = meta;
    }

    const brlUsdRate = prices['BRLUSD'] ?? 1;
    // Realized P/L from sales, derived once here and used by the two snapshot
    // paths in `historyManager` the same way. The `trades.profit` column that
    // used to carry it was dropped in migration 0003, so for a while this was a
    // hardcoded 0 and the figure was interest only — see decision #1 in
    // docs/MODERNIZATION-PLAN.md.
    const realizedFromSales = computeRealizedFromSales(trades ?? [], SYMBOLS, brlUsdRate);
    const input: ValuationInput = {
      trades: trades ?? [],
      prices,
      priceMeta,
      cash: { cashReais: cash?.cashReais ?? 0, cashDollars: cash?.cashDollars ?? 0 },
      realizedFromSells: realizedFromSales.totalUsd,
      interest: { brlTotal: brlInterest?.total ?? 0, usdTotal: usdInterest?.total ?? 0 },
      brlUsdRate,
      symbols: SYMBOLS,
      includeCashRows: true,
      includeCashInAllocation,
    };

    const valuation = computeValuation(input);
    res.json({
      ...valuation,
      brlUsdRate,
      // The "from N sales" line on the realized-P/L card. A count of the trades
      // table, not a valuation, but it belongs with the figure it explains.
      salesCount: (trades ?? []).filter((t) => t.side === 'sell').length,
    });
  } catch (err) {
    console.error('Error computing portfolio valuation', err);
    res.status(500).json({ error: 'Failed to compute portfolio valuation' });
  }
});
