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
      const pf = await import('../services/priceFetcher');
      obj.cacheTTLms = pf.CACHE_TTL || 600000;
    } catch (_) {
      obj.cacheTTLms = 600000;
    }
    res.json(obj);
  } catch (err) {
    console.error('Error fetching prices', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
