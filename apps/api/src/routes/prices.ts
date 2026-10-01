import { Router, Request, Response } from 'express';
import { all } from '../db';

export const pricesRouter = Router();

pricesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await all('SELECT symbol, price, ts, meta FROM price_cache');
    const obj: any = { ts: Date.now(), cacheTTLms: undefined };
    for (const r of rows) {
      obj[r.symbol] = r.price;
      obj[`${r.symbol}_ts`] = r.ts;
      if (r.meta) {
        try {
          obj[`${r.symbol}_meta`] = JSON.parse(r.meta);
        } catch (_) {
          /* ignore malformed meta */
        }
      }
    }
    try {
      // The client uses this as the staleness threshold, so it is
      // `STALE_AFTER_MS` and NOT the fetch cache's `CACHE_TTL`. They were the
      // same value once, which meant the banner appeared on every refresh cycle.
      const pf = await import('../services/priceFetcher');
      obj.cacheTTLms = pf.STALE_AFTER_MS || 1_440_000;
    } catch (_) {
      obj.cacheTTLms = 1_440_000;
    }
    res.json(obj);
  } catch (err) {
    console.error('Error fetching prices', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
