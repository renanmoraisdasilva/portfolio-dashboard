import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { computeRealizedFromSales } from '@portfolio-dashboard/shared';
import { run, get, all } from '../db';
import { computeAndInsertHistoryPoint } from '../services/historyManager';
import { SYMBOLS } from '../config/symbols';

export const tradesRouter = Router();

/** A `trades` row, as the FIFO walk needs it. */
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

function validateTradeRequest(
  symbol: string,
  side: string,
  qty: number,
  price: number | null,
  cashSource?: string,
): string | null {
  if (!symbol || !side || !qty) {
    return 'Missing required fields';
  }

  if (side === 'sell' && (price === undefined || price === null)) {
    return 'Price required for sell trades';
  }

  const assetCurrency = getAssetCurrency(symbol);
  if (cashSource && cashSource !== assetCurrency) {
    return `Asset ${symbol} uses ${assetCurrency}, but ${cashSource} selected as cash source`;
  }

  return null;
}

async function createAutoCashEntry(symbol: string, side: string, qty: number, price: number | null, time: string): Promise<any> {
  const assetCurrency = getAssetCurrency(symbol);
  const amount = side === 'buy' ? -(qty * (price || 0)) : qty * (price || 0);
  const desc = `Trade: ${side.toUpperCase()} ${qty} ${symbol} @ ${price}`;
  const cashEntryId = randomUUID();
  const tradeTs = new Date(time).getTime();

  await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
    cashEntryId,
    assetCurrency,
    amount,
    desc,
    tradeTs,
  ]);
  return get('SELECT * FROM cash WHERE id = ?', [cashEntryId]);
}

tradesRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Time-ordered because the FIFO walk that fills in `profit` is only correct
    // in the order the trades happened.
    const rows = await all('SELECT * FROM trades ORDER BY time ASC');
    const priceRows = await all<{ symbol: string; price: number }>('SELECT symbol, price FROM price_cache');
    const prices: Record<string, number> = {};
    for (const row of priceRows) prices[row.symbol] = row.price;

    // The `profit` column was dropped in migration 0003, so the trade history's
    // Profit column showed `-` on every sell. It is derived here rather than
    // stored, because a stored copy would need writing on every sell and would
    // be wrong anyway if a trade were ever edited. Per trade it is the gain in
    // the symbol's own currency, which is what the old column held and what the
    // view renders; the USD total is `computeRealizedFromSales(...).totalUsd`,
    // used by the valuation and the snapshot writer.
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
      const status = validationError.includes('currency') ? 409 : 400;
      return res.status(status).json({ error: validationError });
    }

    const id = randomUUID();
    const t = time || new Date().toISOString();

    await run('INSERT INTO trades (id, symbol, side, qty, price, time) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      symbol,
      side,
      qty,
      price ?? null,
      t,
    ]);
    const row = await get('SELECT * FROM trades WHERE id = ?', [id]);

    const cashEntry = await createAutoCashEntry(symbol, side, qty, price, t);

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
    await run('DELETE FROM trades WHERE id = ?', [id]);
    res.status(204).send();
    computeAndInsertHistoryPoint({ note: 'post-trade-delete' }).catch((err) =>
      console.error('History snapshot after trade delete failed', err),
    );
  } catch (err) {
    console.error('Error deleting trade', err);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});
