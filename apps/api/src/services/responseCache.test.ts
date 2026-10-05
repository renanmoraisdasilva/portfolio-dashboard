import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../metrics', () => ({
  cacheHitsTotal: { add: vi.fn() },
  cacheMissesTotal: { add: vi.fn() },
  cacheCoalescedTotal: { add: vi.fn() },
}));

import { getOrSetResponse, invalidateResponseCaches, ANALYTICS_CACHE_KEY } from './responseCache';
import { cacheHitsTotal, cacheMissesTotal, cacheCoalescedTotal } from '../metrics';

const hits = vi.mocked(cacheHitsTotal);
const misses = vi.mocked(cacheMissesTotal);
const coalesced = vi.mocked(cacheCoalescedTotal);

function deferredLoader<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { loader: vi.fn(() => promise), resolve, reject };
}

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
    const pending = deferredLoader<{ total: number }>();
    const first = getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, pending.loader);
    const joined = getOrSetResponse(ANALYTICS_CACHE_KEY, 1_000, vi.fn());

    pending.resolve({ total: 1 });
    await first;
    await joined;

    expect(coalesced.add).toHaveBeenCalledTimes(1);
    expect(misses.add).toHaveBeenCalledTimes(1); // one real load, not two
    expect(hits.add).not.toHaveBeenCalled(); // nothing came from the cache

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

    await expect(getOrSetResponse('k', 1_000, async () => ({ total: 42 }))).resolves.toEqual({ total: 42 });
  });
});

describe('invalidateResponseCaches', () => {
  test('a write during an in-flight load does not resurrect the pre-write value', async () => {
    const pending = deferredLoader<{ total: number }>();

    const inflight = getOrSetResponse(ANALYTICS_CACHE_KEY, 60_000, pending.loader);
    await flush();

    invalidateResponseCaches();

    pending.resolve({ total: 'pre-write' as unknown as number });
    await inflight;
    await flush();

    const after = await getOrSetResponse(ANALYTICS_CACHE_KEY, 60_000, async () => ({ total: 99 }));
    expect(after).toEqual({ total: 99 });
  });

  test('a load that started after the invalidation IS cached', async () => {
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
