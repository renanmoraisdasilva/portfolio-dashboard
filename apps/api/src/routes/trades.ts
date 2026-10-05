import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { computeRealizedFromSales } from '@portfolio-dashboard/shared';
import { all, runSync, getSync, transaction } from '../db';
import { computeAndInsertHistoryPoint } from '../services/historyManager';
import { SYMBOLS } from '../config/symbols';

export const tradesRouter = Router();

interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
}

function getAssetCurrency(symbol: string): 'USD' | 'BRL' {
  const asset = SYMBOLS[symbol];
  if (!asset) return 'USD';
  return asset.denominatedInBRL ? 'BRL' : 'USD';
}

interface TradeValidationError {
  status: number;
  message: string;
}

function validateTradeRequest(
  symbol: string,
  side: string,
  qty: number,
  price: number | null,
  cashSource?: string,
): TradeValidationError | null {
  if (!symbol || !side || !qty) {
    return { status: 400, message: 'Missing required fields' };
  }

  if (side === 'sell' && (price === undefined || price === null)) {
    return { status: 400, message: 'Price required for sell trades' };
  }

  const assetCurrency = getAssetCurrency(symbol);
  if (cashSource && cashSource !== assetCurrency) {
    return {
      status: 409,
      message: `Asset ${symbol} uses ${assetCurrency}, but ${cashSource} selected as cash source`,
    };
  }

  return null;
}

function createAutoCashEntry(symbol: string, side: string, qty: number, price: number | null, time: string) {
  const assetCurrency = getAssetCurrency(symbol);
  const amount = side === 'buy' ? -(qty * (price || 0)) : qty * (price || 0);
  const desc = `Trade: ${side.toUpperCase()} ${qty} ${symbol} @ ${price}`;
  const cashEntryId = randomUUID();
  const tradeTs = new Date(time).getTime();

  runSync('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
    cashEntryId,
    assetCurrency,
    amount,
    desc,
    tradeTs,
  ]);
  return getSync('SELECT * FROM cash WHERE id = ?', [cashEntryId]);
}

tradesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await all('SELECT * FROM trades ORDER BY time ASC');
    const priceRows = await all<{ symbol: string; price: number }>('SELECT symbol, price FROM price_cache');
    const prices: Record<string, number> = {};
    for (const row of priceRows) prices[row.symbol] = row.price;

    const { nativeByTradeId } = computeRealizedFromSales(rows as TradeRow[], SYMBOLS, prices['BRLUSD'] ?? 1, prices);
    res.json(rows.map((row) => (row.side === 'sell' ? { ...row, profit: nativeByTradeId[(row as TradeRow).id] ?? 0 } : row)));
  } catch (err) {
    console.error('Error fetching trades', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

tradesRouter.post('/', async (req, res) => {
  try {
    const { symbol, side, qty, price, time, cashSource } = req.body;

    const validationError = validateTradeRequest(symbol, side, qty, price, cashSource);
    if (validationError) {
      return res.status(validationError.status).json({ error: validationError.message });
    }

    const id = randomUUID();
    const t = time || new Date().toISOString();

    const { trade: row, cashEntry } = transaction(() => {
      const cashEntry = createAutoCashEntry(symbol, side, qty, price, t);

      runSync('INSERT INTO trades (id, symbol, side, qty, price, time, cash_entry_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id,
        symbol,
        side,
        qty,
        price ?? null,
        t,
        cashEntry?.id ?? null,
      ]);
      return { trade: getSync('SELECT * FROM trades WHERE id = ?', [id]), cashEntry };
    });

    res.status(201).json({ trade: row, cashEntry });

    computeAndInsertHistoryPoint({ note: 'post-trade' }).catch((err) =>
      console.error('History snapshot after trade insert failed', err),
    );
  } catch (err) {
    console.error('Error adding trade', err);
    res.status(500).json({ error: 'Failed to add trade' });
  }
});

tradesRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    transaction(() => {
      const trade = getSync<{ cash_entry_id: string | null }>('SELECT cash_entry_id FROM trades WHERE id = ?', [id]);
      runSync('DELETE FROM trades WHERE id = ?', [id]);
      if (trade?.cash_entry_id) {
        runSync('DELETE FROM cash WHERE id = ?', [trade.cash_entry_id]);
      }
    });

    res.status(204).send();
    computeAndInsertHistoryPoint({ note: 'post-trade-delete' }).catch((err) =>
      console.error('History snapshot after trade delete failed', err),
    );
  } catch (err) {
    console.error('Error deleting trade', err);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});
