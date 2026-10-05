import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { run, all, get } from '../db';

export const historyRouter = Router();

export function sinceForRange(range: string, now: number): number {
  if (range === 'day') return now - 24 * 60 * 60 * 1000;
  if (range === 'week') return now - 7 * 24 * 60 * 60 * 1000;
  if (range === 'month') return now - 30 * 24 * 60 * 60 * 1000;
  if (range === '6months') return now - 180 * 24 * 60 * 60 * 1000;
  if (range === 'year') return now - 365 * 24 * 60 * 60 * 1000;
  return 0;
}

export const BUCKET_MS: Record<string, number> = {
  day: 30 * 60 * 1000, // one point per 30 min  → up to 48 points
  week: 2 * 60 * 60 * 1000, // one point per 2 hours → up to 84 points
  month: 24 * 60 * 60 * 1000, // one point per day     → up to 30 points
  '6months': 24 * 60 * 60 * 1000, // one point per day     → up to 180 points
  year: 7 * 24 * 60 * 60 * 1000, // one point per week   → up to 52 points
};

export function bucketRows(rows: any[], bucketMs: number): any[] {
  const map = new Map<number, any>();
  for (const row of rows) {
    const bucket = Math.floor((row.ts as number) / bucketMs);
    map.set(bucket, row);
  }
  return Array.from(map.values());
}

historyRouter.get('/', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || 'all';

    if (range === 'all') {
      const rows = await all('SELECT * FROM portfolio_snapshots ORDER BY ts ASC');
      return res.json(rows);
    }

    const since = sinceForRange(range, Date.now());
    const rows = await all('SELECT * FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC', [since]);

    const bucketMs = BUCKET_MS[range];
    const result = bucketMs ? bucketRows(rows, bucketMs) : rows;

    res.json(result);
  } catch (err) {
    console.error('Error fetching history', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

historyRouter.post('/point', async (req: Request, res: Response) => {
  try {
    const { t, ts, v, i, p, manual, note } = req.body;
    if (typeof v !== 'number') return res.status(400).json({ error: 'v (value) is required and must be a number' });
    const id = randomUUID();
    const rowTs = ts || Date.now();
    await run('INSERT INTO portfolio_snapshots (id, t, ts, v, i, p, manual, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      t ?? null,
      rowTs,
      v,
      i ?? null,
      p ?? null,
      manual ? 1 : 0,
      note ?? null,
    ]);
    const row = await get('SELECT * FROM portfolio_snapshots WHERE id = ?', [id]);
    res.status(201).json({ point: row });
  } catch (err) {
    console.error('Error adding history point', err);
    res.status(500).json({ error: 'Failed to add history point' });
  }
});

historyRouter.get('/ohlc', async (req: Request, res: Response) => {
  try {
    const range = (req.query.range as string) || '6months';
    const metric = (req.query.metric as string) === 'pnl' ? 'pnl' : 'value';
    const since = range === 'all' ? 0 : sinceForRange(range, Date.now());

    const OHLC_BUCKET_MS: Record<string, number> = {
      day: 30 * 60 * 1000, // 30-min candles  → up to 48
      week: 6 * 60 * 60 * 1000, // 6-hour candles  → up to 28
      month: 24 * 60 * 60 * 1000, // daily candles   → up to 30
      '6months': 24 * 60 * 60 * 1000, // daily candles   → up to 180
      year: 24 * 60 * 60 * 1000, // daily candles   → up to 365
      all: 24 * 60 * 60 * 1000, // daily candles
    };
    const bucketMs = OHLC_BUCKET_MS[range] ?? OHLC_BUCKET_MS['6months'];

    const rows: any[] = await all(
      since > 0
        ? 'SELECT ts, v, p FROM portfolio_snapshots WHERE ts >= ? ORDER BY ts ASC'
        : 'SELECT ts, v, p FROM portfolio_snapshots ORDER BY ts ASC',
      since > 0 ? [since] : [],
    );

    if (rows.length === 0) return res.json([]);

    const buckets = new Map<number, { open: number; high: number; low: number; close: number; ts: number }>();
    for (const row of rows) {
      const val: number | null = metric === 'pnl' ? row.p : row.v;
      if (val == null) continue;
      const key = Math.floor(row.ts / bucketMs) * bucketMs;
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, { ts: key + Math.floor(bucketMs / 2), open: val, high: val, low: val, close: val });
      } else {
        if (val > existing.high) existing.high = val;
        if (val < existing.low) existing.low = val;
        existing.close = val;
      }
    }

    const result = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);

    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      result[i].open = prev.close;
      if (result[i].open > result[i].high) result[i].high = result[i].open;
      if (result[i].open < result[i].low) result[i].low = result[i].open;
    }

    res.json(result);
  } catch (err) {
    console.error('Error computing OHLC history', err);
    res.status(500).json({ error: 'Failed to compute OHLC history' });
  }
});

historyRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    await run('DELETE FROM portfolio_snapshots WHERE id = ?', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Error deleting history point', err);
    res.status(500).json({ error: 'Failed to delete history point' });
  }
});
