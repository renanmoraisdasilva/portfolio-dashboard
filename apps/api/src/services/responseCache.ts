import { LRUCache } from 'lru-cache';
import { cacheHitsTotal, cacheMissesTotal, cacheCoalescedTotal } from '../metrics';

const cache = new LRUCache<string, object>({ max: 10 });
const inFlight = new Map<string, Promise<unknown>>();

let generation = 0;

export const ANALYTICS_CACHE_KEY = 'analytics';

export async function getOrSetResponse<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cacheHitsTotal.add(1, { cache: key });
    return cached as T;
  }

  const existing = inFlight.get(key);
  if (existing) {
    cacheCoalescedTotal.add(1, { cache: key });
    return existing as Promise<T>;
  }

  cacheMissesTotal.add(1, { cache: key });
  const startedAt = generation;
  const pending = loader();
  inFlight.set(key, pending);

  try {
    const value = await pending;
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
