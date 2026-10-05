import { randomUUID } from 'node:crypto';
import { all, run, get } from '../db';
import { sendAlertNotification } from './homeAssistantService';
import { SYMBOLS as SYMBOL_CONFIGS, getStockSymbols, getCurrencySymbols } from '../config/symbols';
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

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly source: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(`${source} ${status}`);
    this.name = 'HttpError';
  }
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export const MAX_RETRY_AFTER_MS = 10_000;

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
    } catch (e) {}
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
          result.prices = timestamps.map((_: number, idx: number) => {
            const v = closes[idx];
            return typeof v === 'number' ? v : null;
          });
          result.ts = now;
          success = true;
          break;
        }
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) continue;
        console.warn(`Yahoo history fetch failed for candidate ${yf}:`, e);
      }
    }
    if (!success) {
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
