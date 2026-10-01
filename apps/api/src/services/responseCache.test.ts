import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The response cache, and the one race it could not see.
 *
 * `getOrSetResponse` coalesces concurrent loads and `invalidateResponseCaches`
 * fires after any successful write. When a write landed *while* a load was in
 * flight, the loader's `cache.set` ran after the `cache.clear()` and re-populated
 * the cache with data from before the write — so every subsequent read served
 * pre-write state until the TTL lapsed. There was no test file for this module
 * at all, which is why it survived.
 *
 * Also pinned here: a coalesced in-flight request was counted as a cache *hit*,
 * so `cache_hits_total` reported a hit ratio that reflected request collapsing
 * rather than anything the cache actually served.
 */
vi.mock('../metrics', () => ({
  cacheHitsTotal: { add: vi.fn() },
  cacheMissesTotal: { add: vi.fn() },
  cacheCoalescedTotal: { add: vi.fn() },
}));

import { getOrSetResponse, invalidateResponseCaches, ANALYTICS_CACHE_KEY } from './responseCache';
import { cacheHitsTotal, cacheMissesTotal, cacheCoalescedTotal } from '../metrics';

/**
 * The counters, typed as the `Mock` the module factory returns rather than as
 * the OTel `Counter` they stand in for. Casting to the production type would
 * leave `mockClear` untyped, because `@opentelemetry/api`'s `Counter` has no
 * such method.
 */
const hits = vi.mocked(cacheHitsTotal);
const misses = vi.mocked(cacheMissesTotal);
const coalesced = vi.mocked(cacheCoalescedTotal);

/** A loader whose resolution the test controls, so an interleaving is reproducible. */
function deferredLoader<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { loader: vi.fn(() => promise), resolve, reject };
}

/** Lets the microtask queue drain, so pending `await`s inside the module settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  invalidateResponseCaches();
  hits.add.mockClear();
  misses.add.mockClear();
  coalesced.add.mockClear();
});

describe('getOrSetResponse', () => {
  test('serves the second caller from cache without calling the loader again', async () => {
    const loader = vi.fn(async () => ({ total: 1 }));

    const first = await getOrSetResponse('k', 1_000, loader);
    const second = await getOrSetResponse('k', 1_000, loader);

    expect(second).toEqual(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  test('coalesces concurrent callers into one loader call', async () => {
    const pending = deferredLoader<{ total: number }>();

    const a = getOrSetResponse('k', 1_000, pending.loader);
    const b = getOrSetResponse('k', 1_000, pending.loader);
    pending.resolve({ total: 7 });

    await expect(a).resolves.toEqual({ total: 7 });
    await expect(b).resolves.toEqual({ total: 7 });
    expect(pending.loader).toHaveBeenCalledTimes(1);
  });

  test('a real cache hit counts a hit; a coalesced one counts neither a hit nor a miss', async () => {
    // The second caller used to increment `cacheHitsTotal`, so the hit ratio
    // measured request collapsing rather than cache effectiveness. Coalesced
    // requests now have their own metric.
    const pending = deferredLoader<{ total: number }>();
    const first = getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, pending.loader);
    const joined = getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, vi.fn());

    pending.resolve({ total: 1 });
    await first;
    await joined;

    expect(coalesced.add).toHaveBeenCalledTimes(1);
    expect(misses.add).toHaveBeenCalledTimes(1); // one real load, not two
    expect(hits.add).not.toHaveBeenCalled(); // nothing came from the cache

    // A read after the load has settled *is* a genuine hit.
    await expect(getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, vi.fn())).resolves.toEqual({ total: 1 });
    expect(hits.add).toHaveBeenCalledTimes(1);
  });

  test('does not cache a rejected load, so the next call retries', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ total: 3 });

    await expect(getOrSetResponse('k', 1_000, loader)).rejects.toThrow('boom');
    await expect(getOrSetResponse('k', 1_000, loader)).resolves.toEqual({ total: 3 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('drops the in-flight entry after a failure so a retry is not served the rejection', async () => {
    const first = deferredLoader<{ total: number }>();
    const failing = getOrSetResponse('k', 1_000, first.loader);
    first.reject(new Error('boom'));
    await expect(failing).rejects.toThrow('boom');

    // A fresh loader must run. If the rejected promise were still registered in
    // `inFlight`, this would resolve with the same rejection forever.
    await expect(getOrSetResponse('k', 1_000, async () => ({ total: 42 }))).resolves.toEqual({ total: 42 });
  });
});

describe('invalidateResponseCaches', () => {
  test('a write during an in-flight load does not resurrect the pre-write value', async () => {
    // The race. A GET misses and starts loading; a POST commits and clears the
    // cache; the loader then resolves with the value it read *before* the write
    // and writes it into the now-empty cache. Every read after that is stale for
    // the whole TTL - and nothing logs, because every individual step succeeded.
    const pending = deferredLoader<{ total: number }>();

    const inflight = getOrSetResponse(ANALYTICS_CACHE_KEY, 60_000, pending.loader);
    await flush();

    // The write lands: invalidate, exactly as app.ts does on any successful
    // POST/PUT/PATCH/DELETE.
    invalidateResponseCaches();

    pending.resolve({ total: 'pre-write' as unknown as number });
    await inflight;
    await flush();

    // The next reader must not see the value the invalidated load produced.
    const after = await getOrSetResponse(ANALYTICS_CACHE_KEY, 60_000, async () => ({ total: 99 }));
    expect(after).toEqual({ total: 99 });
  });

  test('a load that started after the invalidation IS cached', async () => {
    // The fix must not over-correct into "never cache anything". This asserts
    // the *absence of a second loader call*, which is what distinguishes a cached
    // entry from a freshly loaded one — asserting only the returned value would
    // pass either way, since both loaders can be made to return the same thing.
    invalidateResponseCaches();

    const loader = vi.fn(async () => ({ total: 5 }));
    await getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, loader);

    const secondLoader = vi.fn(async () => ({ total: 999 }));
    await expect(getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, secondLoader)).resolves.toEqual({ total: 5 });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(secondLoader).not.toHaveBeenCalled();
  });

  test('clearing then loading the same key re-runs the loader', async () => {
    await getOrSetResponse('k', 60_000, async () => ({ total: 1 }));
    invalidateResponseCaches();

    const reloaded = vi.fn(async () => ({ total: 2 }));
    await expect(getOrSetResponse('k', 60_000, reloaded)).resolves.toEqual({ total: 2 });
    expect(reloaded).toHaveBeenCalledTimes(1);
  });

  test('two invalidations during one load still discard its result', async () => {
    // The generation is a counter, not a flag, so a second invalidation during
    // the same load must not look like "the first one" to the check.
    const pending = deferredLoader<{ total: number }>();
    const inflight = getOrSetResponse('k', 60_000, pending.loader);
    await flush();

    invalidateResponseCaches();
    invalidateResponseCaches();

    pending.resolve({ total: 'stale' as unknown as number });
    await inflight;
    await flush();

    const after = vi.fn(async () => ({ total: 1 }));
    await expect(getOrSetResponse('k', 60_000, after)).resolves.toEqual({ total: 1 });
    expect(after).toHaveBeenCalledTimes(1);
  });
});
