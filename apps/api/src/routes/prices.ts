import { Router, Request, Response } from 'express';
import { all } from '../db';
import { STALE_AFTER_MS } from '../config/priceFreshness';

export const pricesRouter = Router();

pricesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const rows = await all('SELECT symbol, price, ts, meta FROM price_cache');
    const obj: any = { ts: Date.now() };
    for (const r of rows) {
      obj[r.symbol] = r.price;
      obj[`${r.symbol}_ts`] = r.ts;
      if (r.meta) {
        try {
          obj[`${r.symbol}_meta`] = JSON.parse(r.meta);
        } catch (_) {}
      }
    }
    obj.cacheTTLms = STALE_AFTER_MS;
    res.json(obj);
  } catch (err) {
    console.error('Error fetching prices', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
