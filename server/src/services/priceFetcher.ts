import { randomUUID } from 'node:crypto';
import { all, run, get } from '../db';
import { sendAlertNotification } from './homeAssistantService';
import { SYMBOLS as SYMBOL_CONFIGS, getCryptoSymbols, getStockSymbols, getCurrencySymbols } from '../config/symbols';

// Derived from symbols.ts: any symbol with a coingeckoId is fetched via CoinGecko
const COINGECKO_IDS: Record<string,string> = Object.fromEntries(
  Object.entries(SYMBOL_CONFIGS)
    .filter(([, cfg]) => cfg.coingeckoId)
    .map(([id, cfg]) => [id, cfg.coingeckoId!])
);
const SYMBOLS = Object.keys(SYMBOL_CONFIGS); // ['BTC','ETH','SOL','SPY','GLD','BRLUSD','IBIT']
export const CACHE_TTL = 8 * 60 * 1000; // 8 minutes
const MIN_INTERVAL = CACHE_TTL; // alias for clarity
const ASSET_HISTORY_CACHE_TTL_MS = {
  '1h': 15 * 60 * 1000,
  '1d': 60 * 60 * 1000,
} as const;

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

function sleep(ms:number) { return new Promise(r => setTimeout(r, ms)); }

const FETCH_TIMEOUT_MS = TEST_MODE ? 30_000 : 10_000;

/** Wraps fetch with an AbortController timeout to prevent hung connections (Ch. 8 — unreliable networks). */
function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Appends a price observation to the append-only price_ticks event log. */
async function appendPriceTick(symbol: string, price: number, ts: number, source: string): Promise<void> {
  try {
    await run('INSERT OR IGNORE INTO price_ticks (id, symbol, price, ts, source) VALUES (?, ?, ?, ?, ?)',
      [randomUUID(), symbol, price, ts, source]);
  } catch (e) {
    console.warn(`Failed to record price_tick for ${symbol}:`, e);
  }
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelay = DEFAULT_RETRY_DELAY) : Promise<T> {
  let err: any;
  for (let i=0;i<attempts;i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      // If 429 (rate limit), use longer delay
      const is429 = (e instanceof Error && e.message && e.message.includes('429')) || (typeof e === 'string' && e.includes('429'));
      const delay = is429 ? (baseDelay * 5 * Math.pow(2, i)) : (baseDelay * Math.pow(2, i));
      await sleep(delay);
    }
  }
  throw err;
}

async function fetchCoinGeckoSimple(ids: string[]) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
  const res = await retry(() => fetchWithTimeout(url).then(r => {
    if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
    return r.json();
  }));
  return res;
}

async function fetchStooq(symbol:string) {
  const s = symbol.toLowerCase() + '.us';
  const url = `https://stooq.com/q/l/?s=${s}&i=d`;
  const txt = await retry(() => fetchWithTimeout(url).then(r => {
    if (!r.ok) throw new Error(`Stooq ${r.status}`);
    return r.text();
  }));
  const parts = txt.split(',');
  const v = parseFloat(parts[4]);
  if (isNaN(v)) throw new Error('Invalid stooq response');
  return v;
}

async function fetchYahooClose(symbol:string) {
  // Try multiple candidate tickers for resiliency (some assets may live under different Yahoo tickers)
  const config = SYMBOL_CONFIGS[symbol];
  const candidates = config?.historicalFallbacks || [symbol];
  const period1 = Math.floor((Date.now() - 5 * 24 * 60 * 60 * 1000) / 1000);
  const period2 = Math.floor(Date.now() / 1000);

  for (const yf of candidates) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    try {
      const data = await retry(() => fetchWithTimeout(url).then(r => { if (!r.ok) throw new Error(`YF ${r.status}`); return r.json(); }));
      if (data && data.chart && data.chart.result && data.chart.result[0]) {
        const closes = data.chart.result[0].indicators.quote[0].close || [];
        for (let i = closes.length - 1; i >= 0; i--) {
          if (closes[i] !== null && typeof closes[i] !== 'undefined') return closes[i];
        }
      }
    } catch (e) {
      // Try next candidate. If it's a 404, continue; otherwise warn and continue.
      if (e instanceof Error && /YF 404/.test(e.message)) continue;
      console.warn(`Yahoo fetch failed for ${yf}:`, e);
    }
  }
  throw new Error('Invalid Yahoo response (all candidates failed)');
}

async function fetchBRLUSD() {
  const url = 'https://api.exchangerate-api.com/v4/latest/BRL';
  const data = await retry(() => fetchWithTimeout(url).then(r => {
    if (!r.ok) throw new Error(`Exchange ${r.status}`);
    return r.json();
  }));
  if (!data || !data.rates || !data.rates.USD) throw new Error('Invalid exchange response');
  return data.rates.USD;
}

async function readPrice(symbol:string) {
  const row = await get('SELECT symbol, price, ts FROM price_cache WHERE symbol = ?', [symbol]);
  return row;
}

export async function refreshPrices(force=false) {
  if (running) return;
  running = true;
  try {
    const rows: any[] = await all('SELECT symbol, price, ts FROM price_cache');
    const now = Date.now();
    const symbolMap = new Map(rows.map(r => [r.symbol, r]));

    try {
      const cgIds = Object.values(COINGECKO_IDS);
      const cgRes = await fetchCoinGeckoSimple(cgIds);
      for (const sym of Object.keys(COINGECKO_IDS)) {
        const id = COINGECKO_IDS[sym];
        const price = (cgRes[id] && cgRes[id].usd) ? cgRes[id].usd : null;
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
        if (!force && prev && (now - prev.ts) < MIN_INTERVAL) continue;
        // Fetch latest price
        const price = await fetchYahooClose(s);
        await run('INSERT OR REPLACE INTO price_cache (symbol, price, ts, meta) VALUES (?, ?, ?, ?)', [s, price, now, null]);
        await appendPriceTick(s, price, now, 'yahoo');
        // Stagger requests to avoid hammering Yahoo API
        await sleep(YAHOO_SLEEP_DELAY);
      } catch (e) {
        console.warn(`Failed to fetch ${s}`, e);
      }
    }

    for (const c of getCurrencySymbols()) {
      try {
        const prev = symbolMap.get(c);
        if (force || !prev || (now - prev.ts) >= MIN_INTERVAL) {
          if (c === 'BRLUSD') {
            // Stagger to avoid API hammering
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

    // Check and trigger alerts after prices are updated
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

export async function fetchAndCacheAssetHistory(symbol:string, days=60) {
  const interval = days <= 5 ? '1h' : '1d';
  const now = Date.now();
  const config = SYMBOL_CONFIGS[symbol];
  const cacheTtl = ASSET_HISTORY_CACHE_TTL_MS[interval];

  const row = await get('SELECT data, ts FROM asset_chart_cache WHERE symbol = ? AND days = ? AND interval = ?', [symbol, days, interval]);
  if (row && typeof row.ts === 'number' && (now - row.ts) < cacheTtl) {
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

  let result: AssetHistoryResult = { labels: [], prices: [], ts: now };
  try {
    if (!config) {
      console.warn(`Unknown symbol: ${symbol}`);
      return result;
    }

    // Use hourly intervals for short timeframes (5 days or less), daily for longer
    const formatLabel = (ts: number) => {
      const date = new Date(ts * 1000);
      if (interval === '1h') {
        // For hourly: include time (e.g., "3/7 14:00")
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } else {
        // For daily: just date
        return date.toLocaleDateString();
      }
    };

    // All assets now use Yahoo Finance for unified historical data fetching
    const candidates = config.historicalFallbacks || (config.yahooTicker ? [config.yahooTicker] : []);
    if (candidates.length === 0) {
      // No historical source available — cache empty result
      await run('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)',
        [symbol, days, interval, now, JSON.stringify(result)]);
      return result;
    }
    const period1 = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
    const period2 = Math.floor(Date.now() / 1000);
    let success = false;
    
    for (const yf of candidates) {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
      try {
        const data = await retry(() => fetchWithTimeout(url).then(r => { if (!r.ok) throw new Error(`YF ${r.status}`); return r.json(); }));
        if (data.chart && data.chart.result && data.chart.result[0]) {
          const timestamps = data.chart.result[0].timestamp || [];
          const closes = data.chart.result[0].indicators.quote[0].close || [];
          result.labels = timestamps.map((ts:number) => formatLabel(ts));
          // Preserve index alignment between timestamps and closes; keep nulls where data is missing
          result.prices = timestamps.map((_:number, idx:number) => {
            const v = closes[idx];
            return (typeof v === 'number') ? v : null;
          });
          result.ts = now;
          success = true;
          break;
        }
      } catch (e) {
        // If 404, try next candidate; otherwise log and continue
        if (e instanceof Error && /YF 404/.test(e.message)) continue;
        console.warn(`Yahoo history fetch failed for candidate ${yf}:`, e);
      }
    }
    if (!success) {
      console.warn(`Yahoo history: no valid data for ${symbol} after trying candidates: ${candidates.join(', ')}`);
    }

    await run('INSERT OR REPLACE INTO asset_chart_cache (symbol, days, interval, ts, data) VALUES (?, ?, ?, ?, ?)', [symbol, days, interval, now, JSON.stringify({ labels: result.labels, prices: result.prices })]);
  } catch (e) {
    console.warn('Asset history fetch failed for', symbol, e);
  }
  return result;
}

export async function checkAndTriggerAlerts() {
  try {
    // Get all active alerts
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
        // Check if price crosses threshold
        shouldTrigger = alert.condition === 'below' ? currentPrice < alert.threshold : currentPrice > alert.threshold;
      } else if (alert.alert_type === 'percentage') {
        // Use reference_price as the baseline
        previousPrice = alert.reference_price;

        if (previousPrice) {
          percentageChange = ((currentPrice - previousPrice) / previousPrice) * 100;
          shouldTrigger = alert.condition === 'below' ? percentageChange < -alert.threshold : percentageChange > alert.threshold;
        }
      }

      // Check if alert is already triggered and not dismissed
      const alreadyTriggered = alert.triggered_at !== null && alert.triggered_at !== undefined && alert.is_dismissed === 0;

      if (shouldTrigger && !alreadyTriggered) {
        // Record trigger state directly on the alert row
        await run(
          'UPDATE alerts SET current_price = ?, previous_price = ?, percentage_change = ?, triggered_at = ?, is_dismissed = 0, dismissed_at = NULL WHERE id = ?',
          [currentPrice, previousPrice, percentageChange, now, alert.id]
        );

        // Send Home Assistant notification
        await sendAlertNotification({
          symbol: alert.symbol,
          alert_type: alert.alert_type,
          threshold: alert.threshold,
          condition: alert.condition,
          currentPrice,
          percentageChange,
        });
      } else if (!shouldTrigger && alreadyTriggered) {
        // Clear the trigger state when condition is no longer met
        await run('UPDATE alerts SET is_dismissed = 1, dismissed_at = ? WHERE id = ?', [now, alert.id]);
      }
    }
  } catch (e) {
    console.error('Failed to check and trigger alerts', e);
  }
}
