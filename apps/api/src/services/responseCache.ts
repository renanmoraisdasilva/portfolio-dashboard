import { LRUCache } from 'lru-cache';
import { cacheHitsTotal, cacheMissesTotal } from '../metrics';

const cache = new LRUCache<string, object>({ max: 10 });
const inFlight = new Map<string, Promise<unknown>>();

export const STATE_CACHE_KEY = 'state';
export const ANALYTICS_CACHE_KEY = 'analytics';

export async function getOrSetResponse<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    cacheHitsTotal.inc({ cache: key });
    return cached as T;
  }

  const existing = inFlight.get(key);
  if (existing) {
    cacheHitsTotal.inc({ cache: key });
    return existing as Promise<T>;
  }

  cacheMissesTotal.inc({ cache: key });
  const pending = loader();
  inFlight.set(key, pending);

  try {
    const value = await pending;
    cache.set(key, value as object, { ttl: ttlMs });
    return value;
  } finally {
    inFlight.delete(key);
  }
}

export function invalidateResponseCaches(): void {
  cache.clear();
}
