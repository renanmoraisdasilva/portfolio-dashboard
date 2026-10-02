import express from 'express';
import { all } from '../db';
import { pricesRouter } from './prices';
import { STALE_AFTER_MS, CACHE_TTL } from '../config/priceFreshness';

/**
 * `/api/prices` — the endpoint that hands the client its staleness threshold.
 *
 * This route had no test at all, which is how a second copy of `STALE_AFTER_MS`
 * survived in it: the value was read through `await import('../services/
 * priceFetcher')` inside a `try`/`catch` that substituted a literal `1_440_000`.
 * That literal happened to *equal* `STALE_AFTER_MS`, so it was not a live
 * divergence — but nothing would have noticed if someone tuned `CACHE_TTL` and the
 * literal drifted, because nothing here asserted the value at all.
 *
 * **What these tests can and cannot catch.** They pin the wire value to the
 * constant, so any literal in the handler is caught the moment it differs from it.
 * A literal that happens to equal today's constant is indistinguishable from
 * correct behaviour at runtime, and no runtime assertion can separate the two —
 * which is why removing the possibility structurally (a static import from a module
 * with no side effects) is the actual fix and this is the secondary guard.
 *
 * The *value* is pinned separately, in `priceFetcher.freshness.test.ts`. This suite
 * is about the wiring; that one is about the number.
 */
vi.mock('../db', () => ({ all: vi.fn() }));

const mockedAll = all as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedAll.mockReset();
  mockedAll.mockResolvedValue([]);
});

async function getPrices() {
  const app = express();
  app.use('/api/prices', pricesRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/prices`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

describe('GET /api/prices — the staleness threshold', () => {
  test('sends exactly the constant the fetcher uses', async () => {
    const { status, body } = await getPrices();

    expect(status).toBe(200);
    // Not "sends a number that looks plausible" — sends *the* number, so a literal
    // in this handler is caught as soon as it diverges.
    expect(body.cacheTTLms).toBe(STALE_AFTER_MS);
  });

  test('is never the fetch cache TTL, which is the bug this endpoint had', async () => {
    const { body } = await getPrices();

    // `CACHE_TTL` decides when to refetch; `cacheTTLms` decides when the client
    // says "prices may be stale". They were once the same 8-minute value, so a
    // healthy worker tripped the banner at the end of every cycle.
    expect(body.cacheTTLms).not.toBe(CACHE_TTL);
    expect(STALE_AFTER_MS).toBeGreaterThan(CACHE_TTL);
  });

  test('is present even with no cached prices at all', async () => {
    // An empty `price_cache` is the normal state of a freshly seeded database,
    // and a missing `cacheTTLms` would leave the client with no threshold to warn
    // against — the original code declared the field `undefined` and only filled
    // it after the dynamic import.
    const { body } = await getPrices();

    expect(Object.keys(body)).toContain('cacheTTLms');
    expect(body.cacheTTLms).toBe(STALE_AFTER_MS);
  });
});

describe('GET /api/prices — the payload', () => {
  test('one flat entry per cached symbol, with its timestamp and parsed meta', async () => {
    mockedAll.mockResolvedValue([
      { symbol: 'BTC', price: 64_002, ts: 1780147023633, meta: '{"source":"coingecko"}' },
      { symbol: 'SPY', price: 500, ts: 1780147023633, meta: null },
    ]);

    const { body } = await getPrices();

    expect(body.BTC).toBe(64_002);
    expect(body.BTC_ts).toBe(1780147023633);
    expect(body.BTC_meta).toEqual({ source: 'coingecko' });
    expect(body.SPY).toBe(500);
    // A null `meta` leaves the key off entirely rather than sending `"null"`,
    // which the client would have to distinguish from a real value.
    expect(body).not.toHaveProperty('SPY_meta');
  });

  test('malformed meta is skipped, not fatal', async () => {
    // One row with bad JSON must not cost the caller the other symbols — the
    // handler wraps this parse alone in a try/catch for exactly that reason.
    mockedAll.mockResolvedValue([
      { symbol: 'BTC', price: 1, ts: 2, meta: '{not json' },
      { symbol: 'SPY', price: 3, ts: 4, meta: null },
    ]);

    const { status, body } = await getPrices();

    expect(status).toBe(200);
    expect(body).not.toHaveProperty('BTC_meta');
    expect(body.BTC).toBe(1);
    expect(body.SPY).toBe(3);
  });

  test('a database failure is a 500 that names the endpoint', async () => {
    mockedAll.mockRejectedValue(new Error('database is locked'));

    const { status, body } = await getPrices();

    expect(status).toBe(500);
    expect(body.error).toBe('Failed to fetch prices');
  });
});
