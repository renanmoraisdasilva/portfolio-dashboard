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

/**
 * Stubs `fetch` with a response carrying only the fields `fetchWithTimeout` and
 * the Yahoo/CoinGecko helpers read.
 *
 * Typed as a `Partial<Response>` cast to `Response` rather than `as any`: the
 * module under test only touches `ok`, `status`, `json()` and `headers`, and a
 * full `Response` cannot be constructed without an undici internals hack.
 * Spelling the four fields keeps the cast honest and spends none of the
 * repository's `no-explicit-any` budget.
 */
function stubFetch(response: {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  headers?: Record<string, string>;
}): void {
  const headers = new Headers(response.headers ?? {});
  // Records whether the module *consulted* the headers, which is the observable
  // difference between "honours Retry-After" and "happens to have one". The delay
  // it implies is unobservable under `NODE_ENV=test`, where the base delay is 1ms.
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
/** Whether the last `stubFetch` response had its headers read. */
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

/** Every `INSERT ... asset_chart_cache` the module issued. */
const cacheWrites = (): unknown[][] => mockedDb.run.mock.calls.filter((c) => String(c[0]).includes('asset_chart_cache'));

/**
 * Rate-limit classification.
 *
 * `retry` used to decide whether to back off five times longer by testing whether
 * the error *message* contained `429`. That is the same anti-pattern
 * `routes/trades.ts` carries a post-mortem for — *"a status that depends on message
 * wording breaks the moment someone rewords the message"* — and it misfired in
 * both directions: an error page mentioning `429` in its body counted as rate
 * limiting, and a real rate limit with a reworded message did not.
 *
 * Timing is not observable here (`DEFAULT_RETRY_DELAY` is 1ms under `NODE_ENV=test`),
 * so these assert what *is*: how many attempts a status costs, and whether
 * `Retry-After` is read at all.
 */
describe('fetchAndCacheAssetHistory – HTTP status handling', () => {
  const fetchCalls = (): number => (global.fetch as Mock).mock.calls.length;

  /**
   * Attempts against the *first* candidate ticker only.
   *
   * `SPY` has three `historicalFallbacks`, so a total call count is
   * `candidates x attempts` and does not isolate the retry behaviour. Counting the
   * URLs that mention the first candidate does — one URL means no retry, three
   * means `retry`'s default of three attempts.
   */
  const attemptsOnFirstCandidate = (): number => {
    const calls = (global.fetch as Mock).mock.calls as [string][];
    return calls.filter(([url]) => url.includes('/SPY?')).length;
  };

  test.each([429, 500, 503])('status %i is retried rather than given up on', async (status) => {
    stubFetch({ ok: false, status });
    await fetchAndCacheAssetHistory('SPY', 30);
    // `retry`'s default is three attempts, so every candidate was tried three times.
    expect(attemptsOnFirstCandidate()).toBe(3);
    expect(fetchCalls()).toBe(9); // 3 candidates x 3 attempts
  });

  test('a 404 advances to the next candidate rather than failing the whole fetch', async () => {
    // A wrong ticker is not a transient failure. The candidate loop used to detect
    // this with `/YF 404/.test(e.message)`, which the rename to `Yahoo` would have
    // broken silently: the 404 would stop advancing and a bogus symbol would fail
    // the entire history fetch.
    stubFetch({ ok: false, status: 404 });
    const result = await fetchAndCacheAssetHistory('SPY', 30);

    // Every candidate was tried, so the loop advanced past each 404 rather than
    // giving up on the first one.
    expect(fetchCalls()).toBe(9);
    expect(result).toMatchObject({ labels: [], prices: [] });
    // A 404 is an expected outcome, so each one is skipped *quietly*: the only
    // warning is the single summary line emitted after the candidates are
    // exhausted. Three per-candidate warnings would mean the `continue` above is
    // no longer being reached.
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String((console.warn as Mock).mock.calls[0][0])).toContain('no valid data');
  });

  test('a rate-limited response still completes its retries', async () => {
    stubFetch({ ok: false, status: 429, headers: { 'retry-after': '0.02' } });
    await fetchAndCacheAssetHistory('SPY', 30);
    expect(attemptsOnFirstCandidate()).toBe(3);
    // The delay itself is not assertable here: `DEFAULT_RETRY_DELAY` is 1ms under
    // `NODE_ENV=test`, so every branch finishes at the same wall-clock time.
    // `backoffMs` is tested directly below instead.
  });

  test('an exhausted retry loop returns empty rather than throwing or looping forever', async () => {
    stubFetch({ ok: false, status: 429 });
    await expect(fetchAndCacheAssetHistory('SPY', 30)).resolves.toMatchObject({ labels: [], prices: [] });
    expect(fetchCalls()).toBe(9);
  });
});

/**
 * The back-off arithmetic.
 *
 * Unobservable from a test otherwise: `DEFAULT_RETRY_DELAY` is 1ms under
 * `NODE_ENV=test`, so a rate-limit branch that slept 7 seconds and one that slept
 * 1ms both finish immediately, and only the decision function can be checked.
 */
describe('backoffMs', () => {
  const BASE = 500;

  test('a rate limit backs off five times harder than any other error', () => {
    // The ratio that distinguishes the two branches.
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
    // The invariant: honouring the header can never make a request slower than the
    // rate-limit back-off already did. `MAX_RETRY_AFTER_MS` is the schedule's value
    // for the last attempt, so the cap is not a new budget.
    expect(backoffMs(new HttpError(429, 'Yahoo', 3600), 2, BASE)).toBe(MAX_RETRY_AFTER_MS);
    expect(MAX_RETRY_AFTER_MS).toBe(BASE * 5 * 2 ** 2);
  });

  test('a short Retry-After never *shortens* the exponential wait', () => {
    // Otherwise a server sending `Retry-After: 0` would defeat the back-off.
    expect(backoffMs(new HttpError(429, 'Yahoo', 0), 2, BASE)).toBe(BASE * 5 * 2 ** 2);
    expect(backoffMs(new HttpError(429, 'Yahoo', 0), 2, BASE)).toBeGreaterThan(0);
  });

  test('a non-429 ignores Retry-After entirely', () => {
    // Honouring it on any error would let a 503 stall the worker.
    expect(backoffMs(new HttpError(503, 'Yahoo', 3600), 2, BASE)).toBe(BASE * 2 ** 2);
  });

  test('a non-HttpError is treated as an ordinary failure', () => {
    expect(backoffMs(new Error('network down'), 1, BASE)).toBe(BASE * 2);
    expect(backoffMs('a string', 1, BASE)).toBe(BASE * 2);
  });

  test('classification reads the status, never the message', () => {
    // The whole point of `HttpError`, and the only test here that distinguishes it
    // from the substring check it replaced.
    //
    // `HttpError`'s message is `"<source> <status>"`, so it *happens* to contain
    // "429" — which means every other test in this file passes equally well under
    // `e.message.includes('429')`. Verified: mutating `backoffMs` back to the
    // substring check left all 31 green.
    //
    // So the status has to be carried while the message says something else, which
    // is exactly what "someone rewords the message" looks like.
    const reworded = new HttpError(429, 'Yahoo');
    Object.defineProperty(reworded, 'message', { value: 'rate limited, slow down' });

    expect(reworded.message).not.toContain('429');
    expect(backoffMs(reworded, 0, BASE)).toBe(BASE * 5);
  });

  test('a message that merely mentions 429 is not treated as rate limiting', () => {
    // The other direction. A CDN or proxy error page whose text contains "429"
    // used to trigger the five-times back-off, stalling the worker for a failure
    // that had nothing to do with rate limiting.
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

/**
 * `Retry-After` parsing.
 *
 * Worth testing on its own because it is the one part of the rate-limit path that
 * can fail *silently*: an unparsed header does not throw, it just means the
 * exponential schedule is used instead, so nothing downstream would reveal it.
 */
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
    // The failure mode being avoided: a NaN delay resolves immediately on some
    // timers and hangs on others.
    expect(Number.isNaN(parsed as unknown as number)).toBe(false);
  });

  test('a missing header is undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  test('a 429 with a usable header carries the advice to the retry loop', () => {
    // The wiring: the throw site parses, the error carries it, `retry` uses it.
    const err = new HttpError(429, 'Yahoo', parseRetryAfter('7'));
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(7);
    // The message is unchanged, so logs read exactly as they did before.
    expect(err.message).toBe('Yahoo 429');
    expect(err).toBeInstanceOf(Error);
  });

  test('a 404 is distinguishable from a 429 without reading the message', () => {
    // The point of `HttpError`: the two are told apart structurally now.
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
