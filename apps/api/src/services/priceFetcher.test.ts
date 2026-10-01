vi.mock('../db', () => ({
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
}));

vi.mock('./homeAssistantService', () => ({
  sendAlertNotification: vi.fn(),
}));

import type { Mock } from 'vitest';
import * as db from '../db';
import { fetchAndCacheAssetHistory } from './priceFetcher';

const mockedDb = db as unknown as {
  run: Mock;
  get: Mock;
  all: Mock;
};

function makeYahooHistoryResponse() {
  return {
    chart: {
      result: [
        {
          timestamp: [1700000000, 1700086400],
          indicators: { quote: [{ close: [10.5, 11.0] }] },
        },
      ],
    },
  };
}

let originalConsoleWarn: typeof console.warn;

/**
 * Stubs `fetch` with a response carrying only the fields `fetchWithTimeout` and
 * the Yahoo/CoinGecko helpers read.
 *
 * Typed as a `Partial<Response>` cast to `Response` rather than `as any`: the
 * module under test only touches `ok`, `status` and `json()`, and a full
 * `Response` cannot be constructed without an undici internals hack. Spelling
 * the three fields keeps the cast honest and spends none of the repository's
 * `no-explicit-any` budget.
 */
function stubFetch(response: { ok: boolean; status?: number; json?: () => Promise<unknown> }): void {
  global.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: response.json ?? (async () => ({})),
  } as Partial<Response> as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  originalConsoleWarn = console.warn;
  console.warn = vi.fn();
  stubFetch({ ok: false, status: 404 });
  mockedDb.all.mockResolvedValue([]);
  mockedDb.run.mockResolvedValue(undefined);
  mockedDb.get.mockResolvedValue(undefined);
});

afterEach(() => {
  console.warn = originalConsoleWarn;
});

/** Every `INSERT ... asset_chart_cache` the module issued. */
const cacheWrites = (): unknown[][] => mockedDb.run.mock.calls.filter((c) => String(c[0]).includes('asset_chart_cache'));

describe('fetchAndCacheAssetHistory – regular stock symbol', () => {
  test('calls Yahoo Finance and returns price data', async () => {
    mockedDb.get.mockResolvedValue(undefined);
    stubFetch({ ok: true, json: async () => makeYahooHistoryResponse() });

    const result = await fetchAndCacheAssetHistory('SPY', 30);

    expect(result.labels.length).toBe(2);
    expect(result.prices).toEqual([10.5, 11.0]);
    expect((global.fetch as Mock).mock.calls[0][0]).toMatch(/yahoo/i);
  });

  test('a successful fetch writes the series to the cache', async () => {
    mockedDb.get.mockResolvedValue(undefined);
    stubFetch({ ok: true, json: async () => makeYahooHistoryResponse() });

    await fetchAndCacheAssetHistory('SPY', 30);

    expect(cacheWrites()).toHaveLength(1);
    const [, params] = cacheWrites()[0] as [string, unknown[]];
    expect(JSON.parse(params[4] as string).labels).toHaveLength(2);
  });

  test('a total fetch failure caches NOTHING, so the next request retries', async () => {
    // This write used to run unconditionally. A 429 or a network blip stored
    // `{labels: [], prices: []}` with a fresh timestamp, and the TTL check then
    // served that empty payload as a valid hit for the next 15 minutes — one
    // failed fetch produced a blank chart that outlived the outage.
    mockedDb.get.mockResolvedValue(undefined);
    stubFetch({ ok: false, status: 429 });

    const result = await fetchAndCacheAssetHistory('SPY', 30);

    // The caller still gets an empty result, so the response shape is unchanged.
    expect(result.labels).toEqual([]);
    expect(result.prices).toEqual([]);
    // But nothing was persisted, so the cache is not poisoned.
    expect(cacheWrites()).toHaveLength(0);
  });

  test('a failure leaves an existing cache row untouched', async () => {
    // The point of not writing: the previous row's timestamp stays old enough
    // that the next request misses and tries again, instead of being refreshed
    // into a lie.
    mockedDb.get.mockResolvedValue({ data: '{"labels":["old"],"prices":[1]}', ts: Date.now() - 10_000_000 });
    stubFetch({ ok: false, status: 500 });

    await fetchAndCacheAssetHistory('SPY', 30);

    expect(cacheWrites()).toHaveLength(0);
  });

  test('a malformed Yahoo response is also not cached', async () => {
    // `ok: true` but no chart/result: the loop finds nothing, `success` stays
    // false, and this used to be indistinguishable from the 429 case.
    mockedDb.get.mockResolvedValue(undefined);
    stubFetch({ ok: true, json: async () => ({ chart: { result: [] } }) });

    await fetchAndCacheAssetHistory('SPY', 30);

    expect(cacheWrites()).toHaveLength(0);
  });

  test('an unknown symbol is not cached', async () => {
    mockedDb.get.mockResolvedValue(undefined);

    await fetchAndCacheAssetHistory('NOT_A_SYMBOL', 30);

    expect(cacheWrites()).toHaveLength(0);
  });
});
