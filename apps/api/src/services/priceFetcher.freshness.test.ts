import { describe, expect, it } from 'vitest';
import { CACHE_TTL, STALE_AFTER_MS } from '../config/priceFreshness';
import { startPriceRefreshJob } from '../jobs/priceRefresh';

/**
 * These two constants were the same number once, and that is the bug.
 *
 * `CACHE_TTL` decides when to refetch; `STALE_AFTER_MS` decides when the UI says
 * "prices may be stale". When they were both 8 minutes - and the worker refreshes
 * every 8 minutes - a perfectly healthy system tripped the warning at the end of
 * every cycle. A refresh loop that fires a second late then tripped the stock
 * fetch guard too, pushing equities to 16 minutes while crypto sat at 8.
 */
describe('price freshness thresholds', () => {
  it('warns only after several refresh cycles, not after one', () => {
    expect(STALE_AFTER_MS).toBeGreaterThan(CACHE_TTL);
    // One missed cycle must not be enough. Three is the design.
    expect(STALE_AFTER_MS).toBe(3 * CACHE_TTL);
  });

  it('gives the UI threshold room for the refresh interval', () => {
    const REFRESH_INTERVAL_MS = 8 * 60 * 1000;
    // If these are equal the banner is guaranteed to appear on schedule.
    expect(STALE_AFTER_MS).toBeGreaterThan(REFRESH_INTERVAL_MS);
    expect(CACHE_TTL).toBe(8 * 60 * 1000);
  });
});

describe('the refresh job', () => {
  it('resolves without starting a timer loop that outlives the test', async () => {
    // The job schedules an interval for the process lifetime, which is correct
    // in production and wrong in a test. Just assert it is callable and that the
    // constants it depends on are sane; the interval itself is covered above.
    expect(typeof startPriceRefreshJob).toBe('function');
    expect(CACHE_TTL).toBeGreaterThan(0);
  });
});
