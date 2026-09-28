import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { get, run, all } from '../db';
import { computeAndInsertHistoryPoint } from '../services/historyManager';

export const cashRouter = Router();

const CASH_SUM_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN currency='BRL' THEN amount ELSE 0 END), 0) AS cashReais,
    COALESCE(SUM(CASE WHEN currency='USD' THEN amount ELSE 0 END), 0) AS cashDollars
  FROM cash
`;

cashRouter.get('/', async (req: Request, res: Response) => {
  try {
    const pos = await get(CASH_SUM_SQL);
    const brlInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['BRL'],
    );
    const usdInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['USD'],
    );
    res.json({
      cashReais: pos?.cashReais ?? 0,
      cashDollars: pos?.cashDollars ?? 0,
      interestReais: brlInterest?.total ?? 0,
      interestDollars: usdInterest?.total ?? 0,
    });
  } catch (err) {
    console.error('Error fetching cash', err);
    res.status(500).json({ error: 'Failed to fetch cash positions' });
  }
});

// PUT /api/cash  — interest is now managed via /api/interest/months; this endpoint is a no-op kept for compatibility
cashRouter.put('/', async (req: Request, res: Response) => {
  try {
    const pos = await get(CASH_SUM_SQL);
    const brlInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['BRL'],
    );
    const usdInterest = await get<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM interest WHERE currency = ?',
      ['USD'],
    );
    res.json({
      cashReais: pos?.cashReais ?? 0,
      cashDollars: pos?.cashDollars ?? 0,
      interestReais: brlInterest?.total ?? 0,
      interestDollars: usdInterest?.total ?? 0,
    });
  } catch (err) {
    console.error('Error updating cash', err);
    res.status(500).json({ error: 'Failed to update cash positions' });
  }
});

cashRouter.get('/entries', async (_req: Request, res: Response) => {
  try {
    const rows = await all('SELECT * FROM cash ORDER BY ts DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch cash entries' });
  }
});

cashRouter.post('/entries', async (req: Request, res: Response) => {
  try {
    const { currency, amount, description, ts } = req.body;
    if (!currency || !['BRL', 'USD'].includes(currency)) {
      return res.status(400).json({ error: 'currency must be BRL or USD' });
    }
    if (typeof amount !== 'number' || amount === 0) {
      return res.status(400).json({ error: 'amount must be a non-zero number' });
    }
    const id = randomUUID();
    const entryTs = ts ?? Date.now();
    await run('INSERT INTO cash (id, currency, amount, description, ts) VALUES (?, ?, ?, ?, ?)', [
      id,
      currency,
      amount,
      description ?? '',
      entryTs,
    ]);
    const row = await get('SELECT * FROM cash WHERE id = ?', [id]);
    const pos = await get(CASH_SUM_SQL);
    res.status(201).json({ entry: row, totals: pos });
    computeAndInsertHistoryPoint({ note: 'post-cash' }).catch((err) => console.error('[cash] post-cash snapshot failed:', err));
  } catch (err) {
    console.error('Error adding cash entry', err);
    res.status(500).json({ error: 'Failed to add cash entry' });
  }
});

cashRouter.delete('/entries/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await run('DELETE FROM cash WHERE id = ?', [id]);
    const pos = await get(CASH_SUM_SQL);
    res.json({ ok: true, totals: pos });
    computeAndInsertHistoryPoint({ note: 'post-cash' }).catch((err) => console.error('[cash] post-cash snapshot failed:', err));
  } catch (err) {
    console.error('Error deleting cash entry', err);
    res.status(500).json({ error: 'Failed to delete cash entry' });
  }
});
