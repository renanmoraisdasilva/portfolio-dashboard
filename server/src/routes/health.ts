import { Router, Request, Response } from 'express';
import { get } from '../db';

export const healthRouter = Router();

healthRouter.get('/', async (req: Request, res: Response) => {
  const uptime = process.uptime();
  try {
    const lastPrice = await (async () => { const r = await get('SELECT MAX(ts) as ts FROM price_cache'); return r ? r.ts : null; })();
    const lastAsset = await (async () => { const r = await get('SELECT MAX(ts) as ts FROM asset_chart_cache'); return r ? r.ts : null; })();
    res.json({ ok: true, uptime, lastPriceFetch: lastPrice, lastAssetHistory: lastAsset, dbFile: null });
  } catch (err) {
    res.json({ ok: true, uptime, lastPriceFetch: null, lastAssetHistory: {}, dbFile: null });
  }
});
