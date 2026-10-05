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

function parsePriceMeta(raw: string | null | undefined): { priceBRL?: number } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { priceBRL?: number };
    return typeof parsed?.priceBRL === 'number' ? { priceBRL: parsed.priceBRL } : undefined;
  } catch {
    return undefined;
  }
}

portfolioRouter.get('/valuation', async (req: Request, res: Response) => {
  try {
    const includeCashInAllocation = req.query.cash !== 'investments';

    const [trades, priceRows, cash, brlInterest, usdInterest] = await Promise.all([
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
      salesCount: (trades ?? []).filter((t) => t.side === 'sell').length,
    });
  } catch (err) {
    console.error('Error computing portfolio valuation', err);
    res.status(500).json({ error: 'Failed to compute portfolio valuation' });
  }
});
