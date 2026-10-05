export const CACHE_TTL = 8 * 60 * 1000;

export const STALE_AFTER_MS = 3 * CACHE_TTL;

export const MIN_INTERVAL = 30 * 1000;

export const ASSET_HISTORY_CACHE_TTL_MS = {
  '1h': 15 * 60 * 1000,
  '1d': 60 * 60 * 1000,
} as const;
