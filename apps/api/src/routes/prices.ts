import { Router, Request, Response } from 'express';
import { all } from '../db';
// A static import of a constant from a module with no side effects.
//
// This was `await import('../services/priceFetcher')` inside a `try`/`catch` that
// fell back to a literal `1_440_000`. The literal happened to equal
// `STALE_AFTER_MS`, so it was not a live divergence — but it was a second copy of
// the number in a file with no test, which is the part that could have gone wrong
// the next time someone tuned `CACHE_TTL`. See `config/priceFreshness.ts`.
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
        } catch (_) {
          /* ignore malformed meta */
        }
      }
    }
    // `STALE_AFTER_MS` and NOT the fetch cache's `CACHE_TTL`. They were the same
    // value once, which meant the banner appeared on every refresh cycle — at the
    // one moment the data was exactly as fresh as it was ever going to be.
    obj.cacheTTLms = STALE_AFTER_MS;
    res.json(obj);
  } catch (err) {
    console.error('Error fetching prices', err);
    res.status(500).json({ error: 'Failed to fetch prices' });
  }
});
