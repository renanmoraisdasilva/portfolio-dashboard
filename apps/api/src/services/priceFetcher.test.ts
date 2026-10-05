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
import { backoffMs, fetchAndCacheAssetHistory, HttpError, MAX_RETRY_AFTER_MS, parseRetryAfter } from './priceFetcher';

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

function stubFetch(response: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  headers?: Record<string, string>;
}): void {
  const headers = new Headers(response.headers ?? {});
  stubFetch.lastHeadersRead = false;
  const realGet = headers.get.bind(headers);
  headers.get = ((name: string) => {
    stubFetch.lastHeadersRead = true;
    return realGet(name);
  }) as typeof headers.get;

  global.fetch = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: response.json ?? (async () => ({})),
    headers,
  } as Partial<Response> as Response);
}
stubFetch.lastHeadersRead = false;

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

const cacheWrites = (): unknown[][] => mockedDb.run.mock.calls.filter((c) => String(c[0]).includes('asset_chart_cache'));

describe('fetchAndCacheAssetHistory – HTTP status handling', () => {
  const fetchCalls = (): number => (global.fetch as Mock).mock.calls.length;

  const attemptsOnFirstCandidate = (): number => {
    const calls = (global.fetch as Mock).mock.calls as [string][];
    return calls.filter(([url]) => url.includes('/SPY?')).length;
  };

  test.each([429, 500, 503])('status %i is retried rather than given up on', async (status) => {
    stubFetch({ ok: false, status });
    await fetchAndCacheAssetHistory('SPY', 30);
    expect(attemptsOnFirstCandidate()).toBe(3);
    expect(fetchCalls()).toBe(9); // 3 candidates x 3 attempts
  });

  test('a 404 advances to the next candidate rather than failing the whole fetch', async () => {
    stubFetch({ ok: false, status: 404 });
    const result = await fetchAndCacheAssetHistory('SPY', 30);

    expect(fetchCalls()).toBe(9);
    expect(result).toMatchObject({ labels: [], prices: [] });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String((console.warn as Mock).mock.calls[0][0])).toContain('no valid data');
  });

  test('a rate-limited response still completes its retries', async () => {
    stubFetch({ ok: false, status: 429, headers: { 'retry-after': '0.02' } });
    await fetchAndCacheAssetHistory('SPY', 30);
    expect(attemptsOnFirstCandidate()).toBe(3);
  });

  test('an exhausted retry loop returns empty rather than throwing or looping forever', async () => {
    stubFetch({ ok: false, status: 429 });
    await expect(fetchAndCacheAssetHistory('SPY', 30)).resolves.toMatchObject({ labels: [], prices: [] });
    expect(fetchCalls()).toBe(9);
  });
});

describe('backoffMs', () => {
  const BASE = 500;

  test('a rate limit backs off five times harder than any other error', () => {
    expect(backoffMs(new HttpError(429, 'Yahoo'), 0, BASE)).toBe(backoffMs(new HttpError(500, 'Yahoo'), 0, BASE) * 5);
  });

  test('the delay grows exponentially with the attempt number', () => {
    expect(backoffMs(new HttpError(500, 'Yahoo'), 1, BASE)).toBe(backoffMs(new HttpError(500, 'Yahoo'), 0, BASE) * 2);
    expect(backoffMs(new HttpError(500, 'Yahoo'), 2, BASE)).toBe(backoffMs(new HttpError(500, 'Yahoo'), 1, BASE) * 2);
  });

  test('a usable Retry-After raises the wait to what the server asked for', () => {
    expect(backoffMs(new HttpError(429, 'Yahoo', 7), 0, BASE)).toBe(7_000);
  });

  test("a hostile Retry-After is capped, and the cap is the schedule's own worst case", () => {
    expect(backoffMs(new HttpError(429, 'Yahoo', 3600), 2, BASE)).toBe(MAX_RETRY_AFTER_MS);
    expect(MAX_RETRY_AFTER_MS).toBe(BASE * 5 * 2 ** 2);
  });

  test('a short Retry-After never *shortens* the exponential wait', () => {
    expect(backoffMs(new HttpError(429, 'Yahoo', 0), 2, BASE)).toBe(BASE * 5 * 2 ** 2);
    expect(backoffMs(new HttpError(429, 'Yahoo', 0), 2, BASE)).toBeGreaterThan(0);
  });

  test('a non-429 ignores Retry-After entirely', () => {
    expect(backoffMs(new HttpError(503, 'Yahoo', 3600), 2, BASE)).toBe(BASE * 2 ** 2);
  });

  test('a non-HttpError is treated as an ordinary failure', () => {
    expect(backoffMs(new Error('network down'), 1, BASE)).toBe(BASE * 2);
    expect(backoffMs('a string', 1, BASE)).toBe(BASE * 2);
  });

  test('classification reads the status, never the message', () => {
    const reworded = new HttpError(429, 'Yahoo');
    Object.defineProperty(reworded, 'message', { value: 'rate limited, slow down' });

    expect(reworded.message).not.toContain('429');
    expect(backoffMs(reworded, 0, BASE)).toBe(BASE * 5);
  });

  test('a message that merely mentions 429 is not treated as rate limiting', () => {
    const mentions429 = new HttpError(503, 'Upstream');
    Object.defineProperty(mentions429, 'message', { value: 'upstream returned 429 for an unrelated request' });

    expect(backoffMs(mentions429, 0, BASE)).toBe(BASE);
  });

  test('never returns NaN, whatever it is given', () => {
    for (const error of [new Error('x'), 'boom', undefined, null, new HttpError(429, 'Yahoo', undefined)]) {
      for (const attempt of [0, 1, 2]) {
        expect(Number.isNaN(backoffMs(error, attempt, BASE))).toBe(false);
      }
    }
  });
});

describe('parseRetryAfter', () => {
  test.each([
    ['7', 7],
    ['0', 0],
    ['120', 120],
    [' 30 ', 30],
  ])('reads delta-seconds from %j', (header, expected) => {
    expect(parseRetryAfter(header)).toBe(expected);
  });

  test.each([
    ['an HTTP date', 'Wed, 21 Oct 2026 07:28:00 GMT'],
    ['a negative value', '-5'],
    ['prose', 'try again later'],
    ['an empty string', ''],
  ])('discards %s rather than yielding NaN', (_label, header) => {
    const parsed = parseRetryAfter(header);
    expect(parsed).toBeUndefined();
    expect(Number.isNaN(parsed as unknown as number)).toBe(false);
  });

  test('a missing header is undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  test('a 429 with a usable header carries the advice to the retry loop', () => {
    const err = new HttpError(429, 'Yahoo', parseRetryAfter('7'));
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(7);
    expect(err.message).toBe('Yahoo 429');
    expect(err).toBeInstanceOf(Error);
  });

  test('a 404 is distinguishable from a 429 without reading the message', () => {
    const notFound = new HttpError(404, 'Yahoo');
    expect(notFound.status === 429).toBe(false);
    expect(notFound.retryAfterSeconds).toBeUndefined();
  });
});

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
    mockedDb.get.mockResolvedValue(undefined);
    stubFetch({ ok: false, status: 429 });

    const result = await fetchAndCacheAssetHistory('SPY', 30);

    expect(result.labels).toEqual([]);
    expect(result.prices).toEqual([]);
    expect(cacheWrites()).toHaveLength(0);
  });

  test('a failure leaves an existing cache row untouched', async () => {
    mockedDb.get.mockResolvedValue({ data: '{"labels":["old"],"prices":[1]}', ts: Date.now() - 10_000_000 });
    stubFetch({ ok: false, status: 500 });

    await fetchAndCacheAssetHistory('SPY', 30);

    expect(cacheWrites()).toHaveLength(0);
  });

  test('a malformed Yahoo response is also not cached', async () => {
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
