import { LRUCache } from 'lru-cache';
import { cacheHitsTotal, cacheMissesTotal, cacheCoalescedTotal } from '../metrics';

const cache = new LRUCache<string, object>({ max: 10 });
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Bumped by every invalidation.
 *
 * A load that started before an invalidation must not write its result into the
 * cache afterwards: it read the data *before* the write, so caching it would
 * serve pre-write state for a further TTL. That race is invisible from the
 * outside — the load succeeds, the clear succeeds, the read that follows returns
 * a value that is simply out of date — and nothing threw while it happened.
 *
 * A counter rather than a cleared `inFlight` map, because clearing the map would
 * let a second caller start a *duplicate* load while the first was still running,
 * and the first would then write its result on the way out. Comparing the
 * generation after the load is the check: if it moved, the value is stale and is
 * returned to this caller but not stored.
 */
let generation = 0;

export const ANALYTICS_CACHE_KEY = 'analytics';

export async function getOrSetResponse<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cacheHitsTotal.inc({ cache: key });
    return cached as T;
  }

  // A load already running is *not* a hit: this caller is about to wait on a
  // database read, and nothing came from the cache. It used to increment
  // `cacheHitsTotal`, which made the hit ratio measure request collapsing rather
  // than anything the cache actually served.
  const existing = inFlight.get(key);
  if (existing) {
    cacheCoalescedTotal.inc({ cache: key });
    return existing as Promise<T>;
  }

  cacheMissesTotal.inc({ cache: key });
  const startedAt = generation;
  const pending = loader();
  inFlight.set(key, pending);

  try {
    const value = await pending;
    // Only store the result if no write invalidated the cache while it loaded.
    if (generation === startedAt) {
      cache.set(key, value as object, { ttl: ttlMs });
    }
    return value;
  } finally {
    inFlight.delete(key);
  }
}

export function invalidateResponseCaches(): void {
  generation++;
  cache.clear();
}
