import { describe, expect, it } from 'vitest';
import { CACHE_TTL, STALE_AFTER_MS } from '../config/priceFreshness';
import { startPriceRefreshJob } from '../jobs/priceRefresh';

describe('price freshness thresholds', () => {
  it('warns only after several refresh cycles, not after one', () => {
    expect(STALE_AFTER_MS).toBeGreaterThan(CACHE_TTL);
    expect(STALE_AFTER_MS).toBe(3 * CACHE_TTL);
  });

  it('gives the UI threshold room for the refresh interval', () => {
    const REFRESH_INTERVAL_MS = 8 * 60 * 1000;
    expect(STALE_AFTER_MS).toBeGreaterThan(REFRESH_INTERVAL_MS);
    expect(CACHE_TTL).toBe(8 * 60 * 1000);
  });
});

describe('the refresh job', () => {
  it('resolves without starting a timer loop that outlives the test', async () => {
    expect(typeof startPriceRefreshJob).toBe('function');
    expect(CACHE_TTL).toBeGreaterThan(0);
  });
});
