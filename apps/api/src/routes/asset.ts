import { Router, Request, Response } from 'express';
import { all } from '../db';
import { fetchAndCacheAssetHistory } from '../services/priceFetcher';

export const assetRouter = Router();

// GET /api/asset/:symbol/history?days=60
assetRouter.get('/:symbol/history', async (req: Request, res: Response) => {
  const symbol = req.params.symbol;
  const days = parseInt((req.query.days as string) || '60');
  try {
    const data = await fetchAndCacheAssetHistory(symbol, days);
    res.json({ symbol, labels: data.labels, prices: data.prices, ts: data.ts });
  } catch (err) {
    console.error('Asset history failed', err);
    res.status(500).json({ symbol, labels: [], prices: [], ts: Date.now() });
  }
});

// GET /api/asset/:symbol/ohlc?days=60
// Computes OHLC candlestick data from price_ticks for a given symbol and day range.
// Bucket granularity adapts to the range: ≤7d → 4h candles, ≤365d → daily, else → weekly.
assetRouter.get('/:symbol/ohlc', async (req: Request, res: Response) => {
  const symbol = req.params.symbol;
  // 'BRL' is a frontend alias for the BRLUSD exchange rate stored as 'BRLUSD' in price_ticks
  const dbSymbol = symbol === 'BRL' ? 'BRLUSD' : symbol;
  const days = Math.min(parseInt((req.query.days as string) || '60', 10), 1825);
  if (isNaN(days) || days <= 0) {
    return res.status(400).json({ error: 'Invalid days parameter' });
  }

  const bucketMs = days <= 7   ? 4  * 60 * 60 * 1000      // 4-hour candles
                 : days <= 365  ? 24 * 60 * 60 * 1000      // daily candles
                 :                7  * 24 * 60 * 60 * 1000; // weekly candles

  const since = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const rows = await all<{ price: number; ts: number }>(
      'SELECT price, ts FROM price_ticks WHERE symbol = ? AND ts >= ? ORDER BY ts ASC',
      [dbSymbol, since],
    );

    const map = new Map<number, { open: number; high: number; low: number; close: number }>();
    for (const row of rows) {
      const bucket = Math.floor(row.ts / bucketMs) * bucketMs;
      const candle = map.get(bucket);
      if (!candle) {
        map.set(bucket, { open: row.price, high: row.price, low: row.price, close: row.price });
      } else {
        if (row.price > candle.high) candle.high = row.price;
        if (row.price < candle.low)  candle.low  = row.price;
        candle.close = row.price;
      }
    }

    const candles = Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, ohlc]) => ({ ts, ...ohlc }));

    // Chain candles: each open = previous close so there are no gaps between candles
    for (let i = 1; i < candles.length; i++) {
      candles[i].open = candles[i - 1].close;
      if (candles[i].open > candles[i].high) candles[i].high = candles[i].open;
      if (candles[i].open < candles[i].low)  candles[i].low  = candles[i].open;
    }

    res.json(candles);
  } catch (err) {
    console.error('Asset OHLC failed', err);
    res.status(500).json({ error: 'Failed to fetch OHLC data' });
  }
});
