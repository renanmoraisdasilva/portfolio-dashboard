import { Router, Request, Response } from 'express';
import { get } from '../db';

export const healthRouter = Router();

interface TimestampRow {
  ts: number | null;
}

healthRouter.get('/', async (_req: Request, res: Response) => {
  const uptime = process.uptime();
  try {
    const lastPrice = await get<TimestampRow>('SELECT MAX(ts) as ts FROM price_cache');
    const lastAsset = await get<TimestampRow>('SELECT MAX(ts) as ts FROM asset_chart_cache');
    res.json({
      ok: true,
      uptime,
      lastPriceFetch: lastPrice?.ts ?? null,
      lastAssetHistory: lastAsset?.ts ?? null,
      dbFile: null,
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      uptime,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
