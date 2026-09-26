import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { run, get, all } from '../db';
import { computeAndInsertHistoryPoint } from '../services/historyManager';
import { SYMBOLS } from '../config/symbols';

export const tradesRouter = Router();

// Helper to get default currency for an asset
function getAssetCurrency(symbol: string): 'USD' | 'BRL' {
  const asset = SYMBOLS[symbol];
  if (!asset) return 'USD'; // default to USD for unknown symbols
  return asset.denominatedInBRL ? 'BRL' : 'USD';
}

// Validate trade request parameters
function validateTradeRequest(symbol: string, side: string, qty: number, price: number | null, cashSource?: string): string | null {
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
  
  return null; // validation passed
}

// Create auto cash entry for a trade
async function createAutoCashEntry(symbol: string, side: string, qty: number, price: number | null, time: string): Promise<any> {
  const assetCurrency = getAssetCurrency(symbol);
  const amount = side === 'buy' ? -(qty * (price || 0)) : (qty * (price || 0));
  const desc = `Trade: ${side.toUpperCase()} ${qty} ${symbol} @ ${price}`;
  const cashEntryId = randomUUID();
  const tradeTs = new Date(time).getTime();
  
  await run(
    'INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)',
    [cashEntryId, assetCurrency, amount, desc, tradeTs]
  );
  return get('SELECT * FROM cash WHERE id = ?', [cashEntryId]);
}

// GET /api/trades
tradesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await all('SELECT * FROM trades ORDER BY time ASC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching trades', err);
    res.status(500).json({ error: 'Failed to fetch trades' });
  }
});

// POST /api/trades
tradesRouter.post('/', async (req, res) => {
  try {
    const { symbol, side, qty, price, time, cashSource } = req.body;
    
    // Validate request
    const validationError = validateTradeRequest(symbol, side, qty, price, cashSource);
    if (validationError) {
      const status = validationError.includes('currency') ? 409 : 400;
      return res.status(status).json({ error: validationError });
    }
    
    const id = randomUUID();
    const t = time || new Date().toISOString();
    
    // Insert trade
    await run(
      'INSERT INTO trades (id, symbol, side, qty, price, time) VALUES (?, ?, ?, ?, ?, ?)',
      [id, symbol, side, qty, price ?? null, t]
    );
    const row = await get('SELECT * FROM trades WHERE id = ?', [id]);
    
    // Create auto cash entry
    const cashEntry = await createAutoCashEntry(symbol, side, qty, price, t);
    
    res.status(201).json({ trade: row, cashEntry });
    
    // Snapshot portfolio value immediately after the trade is recorded
    computeAndInsertHistoryPoint({ note: 'post-trade' }).catch(err =>
      console.error('History snapshot after trade insert failed', err)
    );
  } catch (err) {
    console.error('Error adding trade', err);
    res.status(500).json({ error: 'Failed to add trade' });
  }
});

// DELETE /api/trades/:id
tradesRouter.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await run('DELETE FROM trades WHERE id = ?', [id]);
    res.status(204).send();
    // Re-snapshot after removal so history reflects the updated portfolio
    computeAndInsertHistoryPoint({ note: 'post-trade-delete' }).catch(err =>
      console.error('History snapshot after trade delete failed', err)
    );
  } catch (err) {
    console.error('Error deleting trade', err);
    res.status(500).json({ error: 'Failed to delete trade' });
  }
});
