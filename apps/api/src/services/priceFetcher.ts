import { randomUUID } from 'node:crypto';
import { all, run, get } from '../db';
import { sendAlertNotification } from './homeAssistantService';
import { SYMBOLS as SYMBOL_CONFIGS, getStockSymbols, getCurrencySymbols } from '../config/symbols';
// The freshness numbers live in `config/priceFreshness.ts` rather than here,
// because `routes/prices.ts` needs `STALE_AFTER_MS` for the wire contract and
// this module is the worker's — importing it for a constant meant a dynamic
// `import()` inside a request handler, wrapped in a `catch` that substituted a
// different number without logging.
import { MIN_INTERVAL, ASSET_HISTORY_CACHE_TTL_MS } from '../config/priceFreshness';

const COINGECKO_IDS: Record<string, string> = Object.fromEntries(
  Object.entries(SYMBOL_CONFIGS)
    .filter(([, cfg]) => cfg.coingeckoId)
    .map(([id, cfg]) => [id, cfg.coingeckoId!]),
);

const TEST_MODE = process.env.NODE_ENV === 'test';
const DEFAULT_RETRY_DELAY = TEST_MODE ? 1 : 500;
const YAHOO_SLEEP_DELAY = TEST_MODE ? 1 : 800;
const BRLUSD_SLEEP_DELAY = TEST_MODE ? 1 : 500;

let running = false;

type AssetHistoryResult = {
  labels: string[];
  prices: Array<number | null>;
  ts: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const FETCH_TIMEOUT_MS = TEST_MODE ? 30_000 : 10_000;

/** Wraps fetch with an AbortController timeout to prevent hung connections (Ch. 8 — unreliable networks). */
function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function appendPriceTick(symbol: string, price: number, ts: number, source: string): Promise<void> {
  try {
    await run('INSERT OR IGNORE INTO price_ticks (id, symbol, price, ts, source) VALUES (?, ?, ?, ?, ?)', [
      randomUUID(),
      symbol,
      price,
      ts,
      source,
    ]);
  } catch (e) {
    console.warn(`Failed to record price_tick for ${symbol}:`, e);
  }
}

/**
 * An HTTP response that was not ok, carrying its status as data.
 *
 * This exists because `retry` used to decide whether to back off five times longer
 * by testing whether the error *message* contained `429`:
 *
 * ```ts
 * const is429 = e instanceof Error && e.message.includes('429');
 * ```
 *
 * `routes/trades.ts` carries a post-mortem for exactly this shape — *"a status
 * that depends on message wording breaks the moment someone rewords the message"* —
 * and this was the same anti-pattern in the same codebase, unremarked. It also
 * misfired in both directions: a proxy or CDN error page mentioning `429` in its
 * body would be classified as rate limiting, and a real rate limit whose message
 * was reworded would not be.
 *
 * The message is unchanged (`CoinGecko 429`), so logs read the same. Only the
 * classification is now structural.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly source: string,
    /** Seconds from a `Retry-After` header, when the server sent a usable one. */
    readonly retryAfterSeconds?: number,
  ) {
    super(`${source} ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date; only the former is worth
 * honouring.
 *
 * Exported for `priceFetcher.test.ts`. The delay it produces is unobservable from
 * a test — `DEFAULT_RETRY_DELAY` is 1ms under `NODE_ENV=test`, so a 7-second
 * back-off and a 1-second one finish at the same wall-clock time. That makes the
 * *parsing* the only part of this worth testing directly, and it is the part that
 * can go wrong silently: `Number('Wed, 21 Oct 2026 07:28:00 GMT')` is `NaN`, and a
 * `NaN` delay resolves immediately on some timers and hangs on others.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * The most a `Retry-After` header is allowed to extend a wait.
 *
 * Without a cap, honouring the header is a denial-of-service risk against *this*
 * worker: one `Retry-After: 3600` on a rate-limited response, times three attempts
 * times three fallback tickers, is nine hours of sleeping inside a single
 * `fetchAndCacheAssetHistory` call — and the worker's symbol loop is serial, so
 * every other asset waits behind it.
 *
 * The cap is set to the largest delay the exponential schedule *already* used for
 * a 429, which gives a clean invariant: **honouring `Retry-After` can never make a
 * request slower than the rate-limit back-off did before this existed.** It can
 * only replace a guess with the server's own answer, within the budget already
 * being spent.
 */
export const MAX_RETRY_AFTER_MS = 10_000;

/**
 * How long to wait before attempt `attempt` (zero-based).
 *
 * A rate limit backs off five times harder than any other error, and a usable
 * `Retry-After` raises the wait to what the server asked for - bounded by
 * `MAX_RETRY_AFTER_MS`.
 *
 * Exported for the test because the delay is otherwise unobservable:
 * `DEFAULT_RETRY_DELAY` is 1ms under `NODE_ENV=test`, so every branch finishes at
 * the same wall-clock time and only the arithmetic can be checked.
 */
export function backoffMs(error: unknown, attempt: number, baseDelay = DEFAULT_RETRY_DELAY): number {
  const isRateLimited = error instanceof HttpError && error.status === 429;
  const backoff = (isRateLimited ? baseDelay * 5 : baseDelay) * 2 ** attempt;
  if (!isRateLimited || error.retryAfterSeconds === undefined) return backoff;
  const advised = Math.min(error.retryAfterSeconds * 1000, MAX_RETRY_AFTER_MS);
  return Math.max(backoff, advised);
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelay = DEFAULT_RETRY_DELAY): Promise<T> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      // Branch on the status, not on the wording.
      await sleep(backoffMs(e, i, baseDelay));
    }
  }
  throw err;
}

async function fetchCoinGeckoSimple(ids: string[]) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
  const res = await retry(() =>
    fetchWithTimeout(url).then((r) => {
      if (!r.ok) throw new HttpError(r.status, 'CoinGecko', parseRetryAfter(r.headers.get('retry-after')));
      return r.json();
    }),
  );
  return res;
}

async function fetchYahooClose(symbol: string) {
  const config = SYMBOL_CONFIGS[symbol];
  const candidates = config?.historicalFallbacks || [symbol];
  const period1 = Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  for (const yf of candidates) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    try {
      const data = await retry(() =>
        fetchWithTimeout(url).then((r) => {
          if (!r.ok) throw new HttpError(r.status, 'Yahoo', parseRetryAfter(r.headers.get('retry-after')));
          return r.json();
        }),
      );
      if (data && data.chart && data.chart.result && data.chart.result[0]) {
        const closes = data.chart.result[0].indicators.quote[0].close || [];
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] !== null && typeof closes[i] !== 'undefined') return closes[i];
        }
      }
    } catch (e) {
      // A 404 for one ticker means "wrong symbol", not "try again" — move to the
      // next fallback candidate quietly. This was `/YF 404/.test(e.message)`,
      // the same message-substring classification as the 429 above, and renaming
      // the source to `Yahoo` would have broken it silently: a 404 would start
      // logging a warning and, worse, stop advancing to the next ticker.
      if (e instanceof HttpError && e.status === 404) continue;
      console.warn(`Yahoo fetch failed for ${yf}:`, e);
    }
  }
  throw new Error('Invalid Yahoo response (all candidates failed)');
}

async function fetchBRLUSD() {
  const url = 'https://api.exchangerate-api.com/v4/latest/BRL';
  const data = await retry(() =>
    fetchWithTimeout(url).then((r) => {
      throw new HttpError(r.status, 'Exchange', parseRetryAfter(r.headers.get('retry-after')));
      return r.json();
    }),
  );
  if (!data || !data.rates || !data.rates.USD) throw new Error('Invalid exchange response');
  return data.rates.USD;
}

export async function refreshPrices(force = false) {
  if (running) return;
  running = true;
  try {
    const rows: any[] = await all('SELECT symbol, price, ts FROM price_cache');
    const now = Date.now();
    const symbolMap = new Map(rows.map((r) => [r.symbol, r]));

    try {
      const cgIds = Object.values(COINGECKO_IDS);
      const cgRes = await fetchCoinGeckoSimple(cgIds);
      for (const sym of Object.keys(COINGECKO_IDS)) {
        const id = COINGECKO_IDS[sym];
        const price = cgRes[id] && cgRes[id].usd ? cgRes[id].usd : null;
        if (price !== null) {
          await run('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [sym, price, now, null]);
          await appendPriceTick(sym, price, now, 'coingecko');
        }
      }
    } catch (e) {
      console.warn('CoinGecko fetch failed', e);
    }

    for (const s of getStockSymbols()) {
      try {
        const prev = symbolMap.get(s);
        if (!force && prev && now - prev.ts < MIN_INTERVAL) continue;
        const price = await fetchYahooClose(s);
        await run('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [s, price, now, null]);
        await appendPriceTick(s, price, now, 'yahoo');
        await sleep(YAHOO_SLEEP_DELAY);
      } catch (e) {
        console.warn(`Failed to fetch ${s}`, e);
      }
    }

    for (const c of getCurrencySymbols()) {
      try {
        const prev = symbolMap.get(c);
        if (force || !prev || now - prev.ts >= MIN_INTERVAL) {
          if (c === 'BRLUSD') {
            await sleep(BRLUSD_SLEEP_DELAY);
            const rate = await fetchBRLUSD();
            await run('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [c, rate, now, null]);
            await appendPriceTick(c, rate, now, 'exchangerate');
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch ${c}`, e);
      }
    }

    await checkAndTriggerAlerts();
  } finally {
    running = false;
  }
}

export async function getPrices() {
  const rows: any[] = await all('SELECT symbol, price, ts FROM price_cache');
  const out: any = { ts: Date.now() };
  for (const r of rows) out[r.symbol] = r.price;
  return out;
}

export async function fetchAndCacheAssetHistory(symbol: string, days = 60) {
  const interval = days <= 5 ? '1h' : '1d';
  const now = Date.now();
  const config = SYMBOL_CONFIGS[symbol];
  const cacheTtl = ASSET_HISTORY_CACHE_TTL_MS[interval];

  const row = await get('SELECT data, ts FROM asset_chart_cache WHERE symbol = ? AND days = ? AND interval = ?', [
    symbol,
    days,
    interval,
  ]);
  if (row && typeof row.ts === 'number' && now - row.ts < cacheTtl) {
    try {
      const parsed = JSON.parse(row.data);
      return {
        labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        prices: Array.isArray(parsed.prices) ? parsed.prices : [],
        ts: row.ts,
      };
    } catch (e) {
      /* fallthrough */
    }
  }

  const result: AssetHistoryResult = { labels: [], prices: [], ts: now };
  try {
    if (!config) {
      console.warn(`Unknown symbol: ${symbol}`);
      return result;
    }

    const formatLabel = (ts: number) => {
      const date = new Date(ts * 1000);
      if (interval === '1h') {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        return date.toLocaleDateString();
      }
    };

    const candidates = config.historicalFallbacks || (config.yahooTicker ? [config.yahooTicker] : []);
    if (candidates.length === 0) {
      // Nothing to fetch from, so the empty series IS the answer and caching it
      // saves the next request repeating the lookup. This is the one path where
      // an empty cache entry is legitimate.
      await run('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)', [
        symbol,
        days,
        interval,
        now,
        JSON.stringify(result),
      ]);
      return result;
    }
    const period1 = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    let success = false;

    for (const yf of candidates) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
      try {
        const data = await retry(() =>
          fetchWithTimeout(url).then((r) => {
            if (!r.ok) throw new HttpError(r.status, 'Yahoo', parseRetryAfter(r.headers.get('retry-after')));
            return r.json();
          }),
        );
        if (data.chart && data.chart.result && data.chart.result[0]) {
          const timestamps = data.chart.result[0].timestamp || [];
          const closes = data.chart.result[0].indicators.quote[0].close || [];
          result.labels = timestamps.map((ts: number) => formatLabel(ts));
          // Preserve index alignment between timestamps and closes; keep nulls where data is missing
          result.prices = timestamps.map((_: number, idx: number) => {
            const v = closes[idx];
            return typeof v === 'number' ? v : null;
          });
          result.ts = now;
          success = true;
          break;
        }
      } catch (e) {
        // Same as `fetchYahooClose`: a 404 means this ticker is wrong, so try the
        // next candidate. Branched on the status, not on the message.
        if (e instanceof HttpError && e.status === 404) continue;
        console.warn(`Yahoo history fetch failed for candidate ${yf}:`, e);
      }
    }
    if (!success) {
      // Deliberately NOT cached. This write used to run unconditionally, so a
      // network blip or a Yahoo 429 stored `{labels: [], prices: []}` with a
      // *fresh* timestamp - and the TTL check above then served that empty
      // payload as a valid hit for the next 15 minutes (1h) or hour (1d). One
      // failed fetch produced a blank chart that outlived the outage.
      //
      // Leaving the previous row untouched is what makes the next request
      // retry: its timestamp is older than the TTL, so the cache misses and the
      // fetch is attempted again. The caller still receives an empty result, so
      // the response shape is unchanged.
      console.warn(
        `Yahoo history: no valid data for ${symbol} after trying candidates: ${candidates.join(', ')}; cache left unchanged`,
      );
      return result;
    }

    await run('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)', [
      symbol,
      days,
      interval,
      now,
      JSON.stringify({ labels: result.labels, prices: result.prices }),
    ]);
  } catch (e) {
    // Same reasoning: an exception is not a result. The existing cache row, if
    // any, stays authoritative until it ages out.
    console.warn('Asset history fetch failed for', symbol, e);
  }
  return result;
}

export async function checkAndTriggerAlerts() {
  try {
    const alerts: any[] = await all('SELECT * FROM alerts WHERE is_active = 1');
    const now = Date.now();

    for (const alert of alerts) {
      const currentPriceRow = await get('SELECT price FROM price_cache WHERE symbol = ?', [alert.symbol]);
      if (!currentPriceRow) continue;

      const currentPrice = currentPriceRow.price;
      let shouldTrigger = false;
      let previousPrice: number | null = null;
      let percentageChange: number | null = null;

      if (alert.alert_type === 'value') {
        shouldTrigger = alert.condition === 'below' ? currentPrice < alert.threshold : currentPrice > alert.threshold;
      } else if (alert.alert_type === 'percentage') {
        previousPrice = alert.reference_price;

        if (previousPrice) {
          percentageChange = ((currentPrice - previousPrice) / previousPrice) * 100;
          shouldTrigger = alert.condition === 'below' ? percentageChange < -alert.threshold : percentageChange > alert.threshold;
        }
      }

      // Both columns are NOT NULL in the schema (migration 0007), but the `??`
      // is kept deliberately: this function's whole failure mode is a *silently*
      // wrong comparison. `null === 0` is false, so a NULL made the alert read as
      // never-triggered and re-notified on every cycle. Coercing means a row from
      // a pre-0007 database or a hand-edited file cannot reach that state even if
      // the constraint is bypassed.
      const alreadyTriggered = alert.triggered_at !== null && alert.triggered_at !== undefined && (alert.is_dismissed ?? 0) === 0;

      if (shouldTrigger && !alreadyTriggered) {
        await run(
          'UPDATE alerts SET current_price = ?, previous_price = ?, percentage_change = ?, triggered_at = ?, is_dismissed = 0, dismissed_at = NULL WHERE id = ?',
          [currentPrice, previousPrice, percentageChange, now, alert.id],
        );

        await sendAlertNotification({
          symbol: alert.symbol,
          alert_type: alert.alert_type,
          threshold: alert.threshold,
          condition: alert.condition,
          currentPrice,
          percentageChange,
        });
      } else if (!shouldTrigger && alreadyTriggered) {
        await run('UPDATE alerts SET is_dismissed = 1, dismissed_at = ? WHERE id = ?', [now, alert.id]);
      }
    }
  } catch (e) {
    console.error('Failed to check and trigger alerts', e);
  }
}
