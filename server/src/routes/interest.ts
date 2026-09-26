import { Router, Request, Response } from 'express';
import { run, all } from '../db';

export const interestRouter = Router();

// GET /api/interest/months  — optional ?currency=BRL|USD filter
interestRouter.get('/months', async (req: Request, res: Response) => {
  try {
    const { currency } = req.query;
    const rows = currency
      ? await all('SELECT * FROM interest WHERE currency = ? ORDER BY month DESC', [currency as string])
      : await all('SELECT * FROM interest ORDER BY month DESC');
    res.json(rows);
  } catch (err) {
    console.error('Error fetching interest months', err);
    res.status(500).json({ error: 'Failed to fetch interest months' });
  }
});

// POST /api/interest/months
interestRouter.post('/months', async (req: Request, res: Response) => {
  try {
    const { month, amount, currency = 'BRL' } = req.body;
    if (!month || typeof amount !== 'number') return res.status(400).json({ error: 'month and amount required' });
    if (!['BRL', 'USD'].includes(currency as string)) return res.status(400).json({ error: 'currency must be BRL or USD' });
    await run(
      'INSERT OR REPLACE INTO interest (month, currency, amount, created_at) VALUES (?, ?, ?, ?)',
      [month, currency, amount, Date.now()],
    );
    res.status(201).json({ month, currency, amount });
  } catch (err) {
    console.error('Error adding interest month', err);
    res.status(500).json({ error: 'Failed to add interest month' });
  }
});

// DELETE /api/interest/months/:month  — optional ?currency=BRL|USD (default BRL)
interestRouter.delete('/months/:month', async (req: Request, res: Response) => {
  try {
    const month = req.params.month;
    const currency = (req.query.currency as string) || 'BRL';
    await run('DELETE FROM interest WHERE month = ? AND currency = ?', [month, currency]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting interest month', err);
    res.status(500).json({ error: 'Failed to delete interest month' });
  }
});
