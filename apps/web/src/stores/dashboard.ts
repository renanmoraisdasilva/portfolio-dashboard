import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  createPortfolioCalculator,
  createSymbolClassifier,
  formatMoney,
  parseMoney,
  type SymbolMap,
} from '@portfolio-dashboard/shared';
import { ApiError, request, useApi } from '../composables/useApi';

export type Trade = components['schemas']['Trade'];
export type CashEntry = components['schemas']['CashEntry'];
export type Alert = components['schemas']['Alert'];
export type TriggeredAlert = components['schemas']['TriggeredAlert'];
export type OhlcCandle = components['schemas']['OhlcCandle'];
export type HistoryPoint = components['schemas']['HistoryPoint'];
export type SymbolMeta = components['schemas']['SymbolConfig'];

export type Side = 'buy' | 'sell';
export type CashSource = 'USD' | 'BRL';
export type Currency = 'USD' | 'BRL';
export type Metric = 'value' | 'pnl';
export type Tab = 'dashboard' | 'assetCharts';

export interface InterestMonth {
  month: string;
  amount: number;
  currency?: string;
}

export interface PriceMeta {
  priceBRL?: number;
  taxaCompra?: number;
}

/**
 * A trade as this page uses it.
 *
 * The OpenAPI schema types every field as optional and omits `profit`, which the
 * server does return and the realized-P/L maths needs. This is the normalized
 * shape the store works in; `reloadState` maps the API rows onto it.
 */
export interface DashboardTrade {
  id?: string;
  symbol: string;
  side: Side;
  qty: number;
  price?: number | null;
  /** Realized P/L, recorded by the server on sells. */
  profit?: number;
  time: string;
  /** Present only while an optimistic add is in flight. */
  _tmpId?: string;
}

export const ALLOCATION_PALETTE = [
  '#dc2626', '#15803d', '#0891b2', '#1e40af', '#7c3aed',
  '#d97706', '#06b6d4', '#22c55e', '#f97316', '#eab308',
  '#a855f7', '#3b82f6',
];

const CASH_ENTRIES_PAGE_SIZE = 5;
/** Projection horizon: half a year of daily-ish points. */
export const PROJ_DAYS = 182.5;

const usd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl = (n: number): string => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (n: number): string => `${n >= 0 ? '+' : ''}${usd(n)}`;
const signedBrl = (n: number): string => `${n >= 0 ? '+' : ''}${brl(n)}`;

export const CHART_DAY_RANGES = [
  { days: 1825, label: '5Y', title: '5 Years' },
  { days: 730, label: '2Y', title: '2 Years' },
  { days: 365, label: '1Y', title: '1 Year' },
  { days: 180, label: '6M', title: '6 Months' },
  { days: 60, label: '60D', title: '60 Days' },
  { days: 30, label: '30D', title: '30 Days' },
  { days: 10, label: '10D', title: '10 Days' },
  { days: 5, label: '5D', title: '5 Days' },
] as const;

/**
 * Dashboard state.
 *
 * The vanilla page held ~20 module-level variables and re-read the DOM on every
 * recalculation. Here they are reactive state, so `refresh()` is a data action
 * and every card, table and chart is a computed property off the same numbers.
 *
 * Arithmetic is deliberately unchanged: FIFO comes from
 * `createPortfolioCalculator(...).replayFIFOLots`, and each formula below is the
 * legacy line for line. Realized P/L still comes from `trades.profit` (what the
 * server recorded), not from replaying lots — that is the legacy behaviour and
 * the two differ once interest is involved.
 */
export const useDashboardStore = defineStore(
  'dashboard',
  () => {
    const api = useApi();

    // --- Server-owned data -----------------------------------------------------
    const prices = ref<Record<string, number>>({});
    const priceMeta = ref<Record<string, PriceMeta>>({});
    const priceTimestamps = ref<Record<string, number>>({});
    const cacheTtlMs = ref(600_000);
    const trades = ref<DashboardTrade[]>([]);
    const history = ref<HistoryPoint[]>([]);
    const historyOHLC = ref<OhlcCandle[]>([]);
    const pnlOHLC = ref<OhlcCandle[]>([]);
    const cashReais = ref(0);
    const cashDollars = ref(0);
    const interestReais = ref(0);
    const interestDollars = ref(0);
    const interestReaisMonths = ref<InterestMonth[]>([]);
    const interestDollarsMonths = ref<InterestMonth[]>([]);
    const cdiRate = ref(0);
    const brlUsdRate = ref(0);
    const symbolList = ref<string[]>([]);
    const symbolDetails = ref<SymbolMap>({});
    const currencySymbols = ref<string[]>([]);

    // --- UI preferences (persisted) -------------------------------------------
    const allocationShowCash = ref(true);
    const allocCurrency = ref<Currency>('USD');
    const interestMonthsCollapsed = ref(true);
    const interestUSDMonthsCollapsed = ref(true);

    // --- Transient UI state ----------------------------------------------------
    const tab = ref<Tab>('dashboard');
    /**
     * Which chart chip is lit. `all` and `value` both plot portfolio value, but
     * the chip that was clicked stays highlighted — the vanilla page's three
     * buttons were two views plus a shortcut, not three views.
     */
    const activeSeries = ref<'all' | 'value' | 'pnl'>('value');
    const activeMetric = computed<Metric>(() => (activeSeries.value === 'pnl' ? 'pnl' : 'value'));
    const projectionEnabled = ref(false);
    const selectedDays = ref(60);
    const entryCurrency = ref<Currency>('USD');
    const cashEntries = ref<CashEntry[]>([]);
    const cashEntriesPage = ref(1);
    const alerts = ref<Alert[]>([]);
    const triggeredAlerts = ref<TriggeredAlert[]>([]);
    const priceError = ref<string | null>(null);
    const staleWarning = ref<string | null>(null);
    const settingsOpen = ref(false);
    const eraseOpen = ref(false);
    const deleteTradeIndex = ref<number | null>(null);
    const maintenanceLog = ref<Record<string, string>>({});
    const busyMigration = ref<string | null>(null);
    const loading = ref(false);

    // --- Trade form ------------------------------------------------------------
    const formSide = ref<Side>('buy');
    const formSymbol = ref('BTC');
    const formCashSource = ref<CashSource>('USD');
    const qtyInput = ref('');
    const priceInput = ref('');
    const tradeDate = ref('');
    const totalInput = ref('');
    const qtyPct = ref(0);

    const classifier = computed(() => createSymbolClassifier(symbolDetails.value));
    const calculator = computed(() => createPortfolioCalculator(symbolDetails.value));
    const isBRLAsset = (s: string): boolean => classifier.value.isBRLAsset(s);
    const isBRLNonBond = (s: string): boolean => classifier.value.isBRLNonBond(s);
    const isBRLBond = (s: string): boolean => classifier.value.isBRLBond(s);

    /** Assets a user can trade: everything except pure currency pairs. */
    const tradeableSymbols = computed(() =>
      symbolList.value.filter((s) => symbolDetails.value[s] && symbolDetails.value[s]?.type !== 'currency'),
    );

    const priceOf = (s: string): number => prices.value[s] ?? 0;

    /**
     * Maps an API trade row onto `DashboardTrade`.
     *
     * The spec types every field optional and omits `profit`, so this is the one
     * place that looseness is absorbed. Rows without a symbol or quantity cannot
     * be replayed and are dropped by the caller.
     */
    function normalizeTrade(t: Trade & { profit?: number }): DashboardTrade {
      return {
        id: t.id,
        symbol: t.symbol as string,
        side: (t.side ?? 'buy') as Side,
        qty: t.qty as number,
        price: t.price ?? null,
        profit: t.profit,
        time: t.time ?? new Date().toISOString(),
      };
    }

    // --- Lots and positions ---------------------------------------------------

    /** FIFO replay. Falls back to the market price when a trade carries none. */
    const lots = computed<Record<string, Array<{ qty: number; price: number }>>>(() =>
      calculator.value.replayFIFOLots(
        trades.value.map((t) => ({ symbol: t.symbol, side: t.side, qty: t.qty, price: t.price ?? null })),
        prices.value,
      ),
    );

    const positions = computed<Record<string, number>>(() => {
      const out: Record<string, number> = {};
      for (const s of Object.keys(lots.value)) {
        out[s] = lots.value[s].reduce((sum, lot) => sum + lot.qty, 0);
      }
      return out;
    });

    const investedWithCash = computed(() => {
      let invested = 0;
      for (const s of Object.keys(lots.value)) {
        for (const lot of lots.value[s]) {
          invested += isBRLNonBond(s) ? lot.qty * lot.price * brlUsdRate.value : lot.qty * lot.price;
        }
      }
      invested += cashReais.value * brlUsdRate.value;
      invested += cashDollars.value;
      return invested;
    });

    const totalValue = computed(() => {
      let total = 0;
      for (const s of Object.keys(positions.value)) {
        const p = priceOf(s);
        total += isBRLNonBond(s) ? positions.value[s] * p * brlUsdRate.value : positions.value[s] * p;
      }
      total += cashReais.value * brlUsdRate.value;
      total += cashDollars.value;
      return total;
    });

    // --- Metrics ---------------------------------------------------------------

    const metrics = computed(() => {
      const interestFromBRLMonths = interestReaisMonths.value.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      const interestFromUSDMonths = interestDollarsMonths.value.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      const salesCount = trades.value.filter((t) => t.side === 'sell').length;
      const realizedFromTrades = trades.value
        .filter((t) => t.side === 'sell')
        .reduce((sum, t) => {
          const p = t.profit ?? 0;
          return sum + (isBRLNonBond(t.symbol) ? p * brlUsdRate.value : p);
        }, 0);
      const realized = realizedFromTrades + interestFromBRLMonths * brlUsdRate.value + interestFromUSDMonths;

      const invested = investedWithCash.value;
      const total = totalValue.value;
      const investedNet = Math.max(0, invested - realized);
      const unrealized = total - invested;
      const unrealizedPct = invested > 0 ? (unrealized / invested) * 100 : 0;

      const tickerValue = Object.keys(positions.value)
        .filter((s) => s !== 'BRLUSD')
        .reduce((sum, s) => {
          const p = priceOf(s);
          return sum + (isBRLNonBond(s) ? (positions.value[s] || 0) * p * brlUsdRate.value : (positions.value[s] || 0) * p);
        }, 0);
      const investedPct = total > 0 ? (tickerValue / total) * 100 : 0;

      return {
        total,
        invested,
        investedNet,
        realized,
        realizedFromTrades,
        interestFromBRLMonths,
        interestFromUSDMonths,
        salesCount,
        unrealized,
        unrealizedPct,
        tickerValue,
        investedPct,
        breakEven: Math.abs(unrealized) < 0.01,
        // Every BRL sub-line divides by the rate; guard it like the legacy did
        // not, but avoid "Infinity" in the UI.
        brlRate: brlUsdRate.value,
      };
    });

    /** A price fetch with a zero or missing price means the whole UI is wrong. */
    const zeroPriceAssets = computed(() =>
      Object.keys(prices.value).filter((k) => prices.value[k] == null || prices.value[k] === 0),
    );
    const hasPriceError = computed(() => priceError.value !== null || zeroPriceAssets.value.length > 0);

    // --- Position rows ---------------------------------------------------------

    const positionRows = computed(() => {
      const rate = brlUsdRate.value || 1;
      return Object.keys(positions.value).map((s) => {
        const qty = positions.value[s];
        const cost = (lots.value[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0);
        const current = priceOf(s);

        if (isBRLNonBond(s)) {
          const value = qty * current;
          const pl = value - cost;
          return {
            symbol: s,
            qty: qty.toFixed(4),
            avg: formatMoney(qty > 0 ? cost / qty : 0, 'BRL'),
            cur: formatMoney(current, 'BRL'),
            value: formatMoney(value, 'BRL'),
            pl: `${pl >= 0 ? '+' : ''}${formatMoney(pl, 'BRL')}`,
            plPct: `${(cost > 0 ? (pl / cost) * 100 : 0) >= 0 ? '+' : ''}${((cost > 0 ? (pl / cost) * 100 : 0)).toFixed(2)}%`,
            positive: pl >= 0,
          };
        }
        if (isBRLBond(s)) {
          const meta = priceMeta.value[s];
          const costBRL = cost / rate;
          const curBRL = typeof meta?.priceBRL === 'number' ? meta.priceBRL : current / rate;
          const valueBRL = qty * curBRL;
          const plBRL = valueBRL - costBRL;
          const plPct = costBRL > 0 ? (plBRL / costBRL) * 100 : 0;
          return {
            symbol: s,
            qty: qty.toFixed(4),
            avg: formatMoney(qty > 0 ? costBRL / qty : 0, 'BRL'),
            cur: formatMoney(curBRL, 'BRL'),
            value: formatMoney(valueBRL, 'BRL'),
            pl: `${plBRL >= 0 ? '+' : ''}${formatMoney(plBRL, 'BRL')}`,
            plPct: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`,
            positive: plBRL >= 0,
          };
        }
        const value = qty * current;
        const pl = value - cost;
        const plPct = cost > 0 ? (pl / cost) * 100 : 0;
        return {
          symbol: s,
          qty: qty.toFixed(4),
          avg: `$${(qty > 0 ? cost / qty : 0).toFixed(2)}`,
          cur: `$${current.toFixed(2)}`,
          value: `$${value.toFixed(2)}`,
          pl: `${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}`,
          plPct: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`,
          positive: pl >= 0,
        };
      });
    });

    /** Cash rows are part of the positions table, exactly as the legacy page had it. */
    const cashPositionRows = computed(() => {
      const rate = brlUsdRate.value;
      const rows: Array<{
        symbol: string;
        qty: string;
        avg: string;
        cur: string;
        value: string;
        pl: string;
        plPct: string;
        positive: boolean;
      }> = [];

      const interestBRL = interestReaisMonths.value.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      if (cashReais.value > 0 || interestBRL > 0) {
        const plPct = cashReais.value > 0 ? (interestBRL / cashReais.value) * 100 : 0;
        rows.push({
          symbol: 'BRL (100% CDI)',
          qty: cashReais.value.toFixed(2),
          avg: `$${rate.toFixed(4)}`,
          cur: `$${rate.toFixed(4)}`,
          value: `$${(cashReais.value * rate).toFixed(2)}`,
          pl: `${interestBRL >= 0 ? '+' : ''}R$${interestBRL.toFixed(2)}`,
          plPct: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`,
          positive: interestBRL >= 0,
        });
      }

      const interestUSD = interestDollarsMonths.value.reduce((s, m) => s + (Number(m.amount) || 0), 0);
      if (cashDollars.value > 0 || interestUSD > 0) {
        const plPct = cashDollars.value > 0 ? (interestUSD / cashDollars.value) * 100 : 0;
        rows.push({
          symbol: 'Dollar',
          qty: cashDollars.value.toFixed(2),
          avg: '-',
          cur: '-',
          value: `$${cashDollars.value.toFixed(2)}`,
          pl: `${interestUSD >= 0 ? '+' : ''}$${interestUSD.toFixed(2)}`,
          plPct: `${plPct >= 0 ? '+' : ''}${plPct.toFixed(2)}%`,
          positive: interestUSD >= 0,
        });
      }
      return rows;
    });

    // --- Trade history ---------------------------------------------------------

    const tradeRows = computed(() => {
      const rate = brlUsdRate.value || 1;
      return trades.value.map((t) => {
        const symbol = t.symbol as string;
        let price: string;
        let total: string;
        let profit: { text: string; positive: boolean | null };

        if (isBRLNonBond(symbol)) {
          const raw = t.price || priceOf(symbol);
          price = t.price !== null && t.price !== undefined ? formatMoney(raw, 'BRL') : '-';
          total = formatMoney(t.qty * raw, 'BRL');
          profit = { text: '-', positive: null };
          if (t.side === 'sell' && typeof t.profit === 'number') {
            profit = { text: `${t.profit >= 0 ? '+' : ''}${formatMoney(t.profit, 'BRL')}`, positive: t.profit >= 0 };
          }
        } else if (isBRLBond(symbol)) {
          const rawUSD = t.price || priceOf(symbol);
          const rawBRL = rawUSD / rate;
          price = t.price !== null && t.price !== undefined ? formatMoney(rawBRL, 'BRL') : '-';
          total = formatMoney(t.qty * rawBRL, 'BRL');
          profit = { text: '-', positive: null };
          if (t.side === 'sell' && typeof t.profit === 'number') {
            const profitBRL = t.profit / rate;
            profit = { text: `${profitBRL >= 0 ? '+' : ''}${formatMoney(profitBRL, 'BRL')}`, positive: profitBRL >= 0 };
          }
        } else {
          const p = t.price || priceOf(symbol);
          price = t.price !== null && t.price !== undefined ? `$${t.price?.toFixed(2)}` : '-';
          total = `$${(t.qty * p).toFixed(2)}`;
          profit = { text: '-', positive: null };
          if (t.side === 'sell' && typeof t.profit === 'number') {
            profit = { text: `$${t.profit.toFixed(2)}`, positive: t.profit >= 0 };
          }
        }

        return {
          id: t.id,
          time: new Date(t.time as string).toLocaleString(),
          symbol,
          side: String(t.side).toUpperCase(),
          isBuy: t.side === 'buy',
          qty: t.qty,
          price,
          total,
          profit,
        };
      });
    });

    // --- Allocation and P/L ----------------------------------------------------

    const allocation = computed(() => {
      const symbols = Object.keys(positions.value);
      const values = symbols.map((s) => {
        const p = priceOf(s);
        return isBRLNonBond(s) ? positions.value[s] * p * brlUsdRate.value : positions.value[s] * p;
      });

      const labels = [...symbols];
      const slices = [...values];
      if (allocationShowCash.value) {
        if (cashReais.value > 0) {
          labels.push('BRL');
          slices.push(cashReais.value * brlUsdRate.value);
        }
        if (cashDollars.value > 0) {
          labels.push('Dollar');
          slices.push(cashDollars.value);
        }
      }

      const total = values.reduce((a, b) => a + b, 0) + (allocationShowCash.value ? cashReais.value * brlUsdRate.value + cashDollars.value : 0);
      return {
        labels,
        values: slices,
        pcts: slices.map((v) => (total > 0 ? (v / total) * 100 : 0)),
        colors: labels.map((_, i) => ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length]),
      };
    });

    const plByAsset = computed(() => {
      const symbols = Object.keys(positions.value);
      const values = symbols.map((s) => {
        const cost = (lots.value[s] || []).reduce((sum, lot) => sum + lot.qty * lot.price, 0);
        const value = positions.value[s] * priceOf(s);
        const pl = value - cost;
        return isBRLNonBond(s) ? pl * brlUsdRate.value : pl;
      });
      return { labels: symbols, values, colors: values.map((v) => (v >= 0 ? '#10b981' : '#ef4444')) };
    });

    /**
     * Least-squares trend of the history, extended forward.
     *
     * Timestamps are normalised to hours before fitting: raw millisecond values
     * lose the precision that makes the denominator stable.
     */
    const projection = computed(() => {
      if (!projectionEnabled.value) return [];
      const source = history.value;
      const n = source.length;
      if (n < 2) return [];

      const t0 = source[0].ts ?? 0;
      const xs = source.map((h) => ((h.ts ?? 0) - t0) / (1000 * 60 * 60));
      const ys = source.map((h) => h.v ?? 0);
      let sumX = 0;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      for (let i = 0; i < n; i++) {
        sumX += xs[i];
        sumY += ys[i];
        sumXY += xs[i] * ys[i];
        sumXX += xs[i] * xs[i];
      }
      const denom = n * sumXX - sumX * sumX;
      if (Math.abs(denom) < 1e-9) return [];
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;

      const lastTs = source[n - 1].ts ?? Date.now();
      const durationDays = ((source[n - 1].ts ?? 0) - (source[0].ts ?? 0)) / (1000 * 60 * 60 * 24) || 1;
      const pointsPerDay = n / durationDays;
      const numPoints = Math.min(200, Math.max(10, Math.round(pointsPerDay * PROJ_DAYS)));
      const step = (PROJ_DAYS * 24 * 60 * 60 * 1000) / numPoints;

      const points: Array<{ ts: number; v: number }> = [];
      for (let i = 1; i <= numPoints; i++) {
        const ts = lastTs + i * step;
        points.push({ ts, v: Math.max(0, slope * ((ts - t0) / (1000 * 60 * 60)) + intercept) });
      }
      return points;
    });

    const valueCandles = computed(() => {
      const source = activeMetric.value === 'pnl' ? pnlOHLC.value : historyOHLC.value;
      return source.map((c) => ({
        time: Math.floor((c.ts ?? 0) / 1000),
        open: c.open ?? 0,
        high: c.high ?? 0,
        low: c.low ?? 0,
        close: c.close ?? 0,
      }));
    });

    // --- Trade form ------------------------------------------------------------

    const parsedQty = computed(() => parseFloat(qtyInput.value) || 0);
    const parsedPrice = computed(() => parseFloat(priceInput.value) || 0);

    function totalFromQty(): string {
      const qty = parsedQty.value;
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return '';
      const source = formCashSource.value;

      if (isBRLAsset(symbol)) {
        const totalBRL = qty * price;
        return source === 'USD' ? formatMoney(totalBRL * brlUsdRate.value, 'USD') : formatMoney(totalBRL, 'BRL');
      }
      const totalUSD = qty * price;
      return source === 'USD' ? formatMoney(totalUSD, 'USD') : formatMoney(totalUSD / brlUsdRate.value, 'BRL');
    }

    function qtyFromTotal(): string {
      const total = parseMoney(totalInput.value, formCashSource.value === 'USD' ? 'USD' : 'BRL');
      if (!total || total <= 0) return '';
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return '';

      if (isBRLAsset(symbol)) {
        const totalBRL = formCashSource.value === 'USD' ? total / brlUsdRate.value : total;
        return String(+(totalBRL / price).toFixed(4));
      }
      const totalUSD = formCashSource.value === 'USD' ? total : total * brlUsdRate.value;
      return String(+(totalUSD / price).toFixed(4));
    }

    /** Share of the available cash (or of the open position, when selling). */
    function qtyFromPct(pct: number): number {
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return 0;

      if (formSide.value === 'sell') {
        const pos = (lots.value[symbol] || []).reduce((s, l) => s + l.qty, 0);
        return +((pos * pct) / 100).toFixed(4);
      }
      const source = formCashSource.value;
      if (isBRLNonBond(symbol)) {
        const availBRL = source === 'USD' ? cashDollars.value / (brlUsdRate.value || 1) : cashReais.value;
        return +(((availBRL * pct) / 100) / price).toFixed(4);
      }
      const availableUsd = source === 'USD' ? cashDollars.value : cashReais.value * brlUsdRate.value;
      return +((availableUsd * (pct / 100)) / price).toFixed(4);
    }

    /** The reverse: what share of the budget the typed quantity represents. */
    function pctFromQty(qty: number): number {
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return 0;

      if (formSide.value === 'sell') {
        const pos = (lots.value[symbol] || []).reduce((s, l) => s + l.qty, 0);
        const pct = pos > 0 ? Math.round((qty / pos) * 100) : 0;
        return Math.min(100, Math.max(0, pct));
      }
      const source = formCashSource.value;
      const availableUsd = source === 'USD' ? cashDollars.value : cashReais.value * brlUsdRate.value;
      const pct = availableUsd > 0 ? Math.round(((qty * price) / availableUsd) * 100) : 0;
      return Math.min(100, Math.max(0, pct));
    }

    function setQty(text: string): void {
      qtyInput.value = text;
      totalInput.value = totalFromQty();
      qtyPct.value = pctFromQty(parseFloat(text) || 0);
    }

    function setQtyPct(pct: number): void {
      qtyPct.value = pct;
      qtyInput.value = String(qtyFromPct(pct));
      totalInput.value = totalFromQty();
    }

    function setPrice(text: string): void {
      priceInput.value = text;
      totalInput.value = totalFromQty();
    }

    function setTotal(text: string): void {
      const parsed = parseMoney(text, formCashSource.value === 'USD' ? 'USD' : 'BRL');
      totalInput.value =
        parsed && parsed > 0
          ? formCashSource.value === 'USD' ? formatMoney(parsed, 'USD') : formatMoney(parsed, 'BRL')
          : text;
      const qty = qtyFromTotal();
      if (qty) qtyInput.value = qty;
    }

    /** Seeds the price field when the asset changes: bonds quote in R$. */
    function syncPriceToSymbol(): void {
      const s = formSymbol.value;
      if (!isBRLAsset(s)) {
        totalInput.value = totalFromQty();
        qtyPct.value = pctFromQty(parsedQty.value);
        return;
      }
      const brlPrice = isBRLNonBond(s)
        ? priceOf(s)
        : typeof priceMeta.value[s]?.priceBRL === 'number'
          ? priceMeta.value[s].priceBRL
          : brlUsdRate.value > 0 ? priceOf(s) / brlUsdRate.value : 0;
      priceInput.value = brlPrice > 0 ? brlPrice.toFixed(2) : '';
      totalInput.value = totalFromQty();
      qtyPct.value = pctFromQty(parsedQty.value);
    }

    function setFormSide(side: Side): void {
      formSide.value = side;
      totalInput.value = totalFromQty();
      qtyPct.value = pctFromQty(parsedQty.value);
    }

    /** Converting the cash source converts whatever total is already typed. */
    function setCashSource(source: CashSource): void {
      const previous = formCashSource.value;
      formCashSource.value = source;
      if (totalInput.value) {
        const parsed = parseMoney(totalInput.value, previous === 'USD' ? 'USD' : 'BRL');
        let converted = parsed;
        if (previous !== source && brlUsdRate.value > 0) {
          converted = previous === 'USD' ? parsed / brlUsdRate.value : parsed * brlUsdRate.value;
        }
        totalInput.value = source === 'USD' ? formatMoney(converted, 'USD') : formatMoney(converted, 'BRL');
        const qty = qtyFromTotal();
        if (qty) qtyInput.value = qty;
      }
      qtyPct.value = pctFromQty(parsedQty.value);
    }

    /** Bonds quote in R$ but store USD, so the form converts on submit. */
    function resolvedTradePrice(): number | null {
      const typed = priceInput.value ? parseFloat(priceInput.value) : null;
      const s = formSymbol.value;
      if (isBRLBond(s)) {
        const brlP =
          typed !== null
            ? typed
            : typeof priceMeta.value[s]?.priceBRL === 'number'
              ? priceMeta.value[s].priceBRL
              : brlUsdRate.value > 0 ? priceOf(s) / brlUsdRate.value : null;
        return brlP !== null && brlUsdRate.value > 0 ? brlP / brlUsdRate.value : (prices.value[s] ?? null);
      }
      return typed !== null ? typed : (prices.value[s] ?? null);
    }

    function resetTradeForm(): void {
      formSymbol.value = 'BTC';
      formSide.value = 'buy';
      qtyInput.value = '';
      priceInput.value = '';
      tradeDate.value = '';
      totalInput.value = '';
      qtyPct.value = 0;
    }

    /**
     * Adds the trade locally first, then persists — the optimistic path the
     * legacy page used, so the UI never waits on the network.
     */
    async function addTrade(): Promise<string | null> {
      const trade: DashboardTrade = {
        symbol: formSymbol.value,
        side: formSide.value,
        qty: parseFloat(qtyInput.value),
        price: resolvedTradePrice(),
        time: new Date().toISOString(),
        _tmpId: `tmp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      };
      trades.value.push(trade);
      resetTradeForm();

      try {
        const data = await request(
          api.POST('/trades', {
            // Only the fields the API stores: `_tmpId` and `profit` are local.
            body: {
              symbol: trade.symbol,
              side: trade.side,
              qty: trade.qty,
              price: trade.price ?? undefined,
              time: trade.time,
              cashSource: formCashSource.value,
            },
          }),
          'POST',
          '/trades',
        );
        if (!data) throw new ApiError('POST', '/trades', 200, 'Server rejected trade');

        const idx = trades.value.findIndex((t) => t._tmpId === trade._tmpId);
        if (idx >= 0 && data.trade) {
          trades.value[idx] = normalizeTrade(data.trade);
          await Promise.all([loadCashEntries(1), reloadState(), loadTriggeredAlerts()]);
          if (data.cashEntry) {
            const entry = data.cashEntry;
            const amount = Math.abs(entry.amount ?? 0);
            const formatted =
              entry.currency === 'BRL'
                ? amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            return `Trade recorded. Cash ${trade.side === 'buy' ? 'deducted' : 'added'}: ${entry.currency === 'BRL' ? 'R$ ' : '$'}${formatted} ${entry.currency}`;
          }
        }
        return null;
      } catch (err) {
        console.warn('[dashboard] add trade failed:', err);
        await reloadState().catch(() => undefined);
        // A rejected trade (409 currency mismatch, 400 missing sell price) comes
        // back with the server's own message, which is what the user needs.
        return err instanceof ApiError ? err.message : `Error: ${String(err)}`;
      }
    }

    function requestDeleteTrade(index: number): void {
      deleteTradeIndex.value = index;
    }

    async function confirmDeleteTrade(): Promise<void> {
      const idx = deleteTradeIndex.value;
      if (idx === null) return;
      const t = trades.value[idx];
      if (t?.id) {
        try {
          await request(api.DELETE('/trades/{id}', { params: { path: { id: t.id } } }), 'DELETE', '/trades/{id}');
        } catch (err) {
          console.warn('[dashboard] delete trade failed on the server, removing locally:', err);
        }
      }
      trades.value.splice(idx, 1);
      deleteTradeIndex.value = null;
      await reloadState().catch((err) => console.warn('[dashboard] reload after delete failed:', err));
    }

    // --- Interest --------------------------------------------------------------

    async function addInterestMonth(currency: Currency, month: string, raw: string): Promise<string | null> {
      const amount = +(parseMoney(raw, currency).toFixed(2)) || 0;
      if (!month) return 'Please select a month';
      const list = currency === 'BRL' ? interestReaisMonths : interestDollarsMonths;
      const idx = list.value.findIndex((m) => m.month === month);
      if (idx >= 0) list.value[idx].amount = amount;
      else list.value.push(currency === 'USD' ? { month, amount, currency: 'USD' } : { month, amount });
      list.value.sort((a, b) => b.month.localeCompare(a.month));
      let truncated = false;
      if (list.value.length > 12) {
        list.value = list.value.slice(0, 12);
        truncated = true;
      }
      if (currency === 'BRL') interestMonthsCollapsed.value = false;
      else interestUSDMonthsCollapsed.value = false;

      await request(
        api.POST('/interest/months', {
          body: currency === 'USD' ? { month, amount, currency: 'USD' } : { month, amount },
        }),
        'POST',
        '/interest/months',
      );
      return truncated ? 'Keeping only latest 12 months; oldest entry removed.' : null;
    }

    async function deleteInterestMonth(currency: Currency, month: string): Promise<void> {
      if (currency === 'BRL') interestReaisMonths.value = interestReaisMonths.value.filter((m) => m.month !== month);
      else interestDollarsMonths.value = interestDollarsMonths.value.filter((m) => m.month !== month);
      await request(
        api.DELETE('/interest/months/{month}', {
          params: {
            path: { month },
            ...(currency === 'USD' ? { query: { currency: 'USD' } } : {}),
          },
        }),
        'DELETE',
        '/interest/months/{month}',
      );
      await reloadState();
    }

    // --- Cash ledger -----------------------------------------------------------

    async function loadCashEntries(page?: number): Promise<void> {
      if (page !== undefined) cashEntriesPage.value = page;
      const entries = await request(api.GET('/cash/entries'), 'GET', '/cash/entries');
      cashEntries.value = Array.isArray(entries) ? entries : [];
    }

    const cashEntriesPages = computed(() => Math.ceil(cashEntries.value.length / CASH_ENTRIES_PAGE_SIZE));
    const cashEntryRows = computed(() => {
      const total = cashEntriesPages.value;
      const current = Math.max(1, Math.min(cashEntriesPage.value, total || 1));
      const start = (current - 1) * CASH_ENTRIES_PAGE_SIZE;
      return cashEntries.value.slice(start, start + CASH_ENTRIES_PAGE_SIZE).map((e) => ({
        id: e.id ?? '',
        date: new Date(e.ts ?? 0).toLocaleDateString('pt-BR'),
        currency: e.currency ?? 'USD',
        amount: formatMoney(e.amount ?? 0, e.currency === 'BRL' ? 'BRL' : 'USD'),
        positive: (e.amount ?? 0) >= 0,
      }));
    });

    async function addCashEntry(amountText: string, date: string): Promise<string | null> {
      const raw = amountText.trim();
      const amount = parseFloat(raw.replace(/[^\d.-]/g, ''));
      if (!raw || isNaN(amount) || amount === 0) return 'Enter a non-zero amount (e.g. +1000 or -500)';
      const ts = date ? new Date(`${date}T12:00:00`).getTime() : Date.now();

      try {
        await request(api.POST('/cash/entries', { body: { currency: entryCurrency.value, amount, ts } }), 'POST', '/cash/entries');
      } catch (err) {
        console.warn('[dashboard] add cash entry failed:', err);
        return 'Failed to add cash entry';
      }
      await Promise.all([loadCashEntries(1), reloadState()]);
      return null;
    }

    async function deleteCashEntry(id: string): Promise<string | null> {
      try {
        await request(api.DELETE('/cash/entries/{id}', { params: { path: { id } } }), 'DELETE', '/cash/entries/{id}');
      } catch (err) {
        console.warn('[dashboard] delete cash entry failed:', err);
        return 'Failed to delete cash entry';
      }
      await Promise.all([loadCashEntries(), reloadState()]);
      return null;
    }

    // --- Alerts ----------------------------------------------------------------

    const alertRows = computed(() =>
      alerts.value.map((a) => {
        const brl = isBRLAsset(a.symbol ?? '');
        const locale = brl ? 'pt-BR' : 'en-US';
        const symbolPrefix = brl ? 'R$ ' : '$';
        const threshold = a.threshold ?? 0;
        const label =
          a.alert_type === 'value'
            ? `${a.condition === 'below' ? 'Falls Below' : 'Rises Above'} ${symbolPrefix}${threshold.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `${a.condition === 'below' ? 'Down' : 'Up'} ${threshold.toFixed(2)}% from ${symbolPrefix}${(a.reference_price ?? 0).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        return { id: a.id ?? '', symbol: a.symbol ?? '', label, isActive: Boolean(a.is_active) };
      }),
    );

    const triggeredRows = computed(() =>
      triggeredAlerts.value.map((t) => {
        const brl = isBRLAsset(t.symbol ?? '');
        const locale = brl ? 'pt-BR' : 'en-US';
        const prefix = brl ? 'R$ ' : '$';
        const current = t.current_price ?? 0;
        const priceText =
          t.alert_type === 'value'
            ? `${prefix}${current.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : `${t.percentage_change ? t.percentage_change.toFixed(2) : '0'}%`;
        const details =
          t.previous_price && t.percentage_change
            ? `from ${prefix}${(t.previous_price).toLocaleString(locale, { minimumFractionDigits: 2 })} to ${prefix}${current.toLocaleString(locale, { minimumFractionDigits: 2 })} (${t.percentage_change.toFixed(2)}% change)`
            : `Currently at ${prefix}${current.toLocaleString(locale, { minimumFractionDigits: 2 })}`;
        return {
          id: t.id ?? '',
          symbol: t.symbol ?? '',
          priceText,
          details,
          triggeredAt: t.triggered_at ? new Date(t.triggered_at).toLocaleString() : '',
        };
      }),
    );

    async function loadAlerts(): Promise<void> {
      const list = await request(api.GET('/alerts'), 'GET', '/alerts');
      alerts.value = Array.isArray(list) ? list : [];
    }

    async function loadTriggeredAlerts(): Promise<void> {
      const triggered = await request(api.GET('/alerts/triggered'), 'GET', '/alerts/triggered');
      triggeredAlerts.value = Array.isArray(triggered) ? triggered : [];
    }

    async function createAlert(body: {
      symbol: string;
      alert_type: 'value' | 'percentage';
      threshold: number;
      condition: 'above' | 'below';
      reference_price?: number;
    }): Promise<string | null> {
      try {
        await request(api.POST('/alerts', { body }), 'POST', '/alerts');
      } catch (err) {
        console.warn('[dashboard] create alert failed:', err);
        return 'Error: Failed to create alert';
      }
      await Promise.all([loadAlerts(), loadTriggeredAlerts()]);
      return null;
    }

    async function deleteAlert(id: string): Promise<string | null> {
      try {
        await request(api.DELETE('/alerts/{id}', { params: { path: { id } } }), 'DELETE', '/alerts/{id}');
      } catch (err) {
        console.warn('[dashboard] delete alert failed:', err);
        return 'Error deleting alert';
      }
      await Promise.all([loadAlerts(), loadTriggeredAlerts()]);
      return null;
    }

    async function dismissAlert(id: string): Promise<void> {
      try {
        await request(
          api.POST('/alerts/dismiss/{triggeredAlertId}', { params: { path: { triggeredAlertId: id } } }),
          'POST',
          '/alerts/dismiss/{triggeredAlertId}',
        );
      } catch (err) {
        console.warn('[dashboard] dismiss alert failed:', err);
        return;
      }
      await loadTriggeredAlerts().catch((err) => console.warn('[dashboard] reload triggered alerts failed:', err));
    }

    // --- Settings and maintenance ---------------------------------------------

    async function clearHistory(): Promise<void> {
      await request(api.DELETE('/history'), 'DELETE', '/history');
      history.value = [];
      historyOHLC.value = [];
      pnlOHLC.value = [];
    }

    async function eraseAll(): Promise<void> {
      await request(api.DELETE('/state'), 'DELETE', '/state');
      trades.value = [];
      history.value = [];
      cashReais.value = 0;
      cashDollars.value = 0;
      interestReais.value = 0;
      interestDollars.value = 0;
      interestReaisMonths.value = [];
      interestMonthsCollapsed.value = false;
      eraseOpen.value = false;
    }

    /**
     * Downloads a backup.
     *
     * Prefers the server export — it spans cash entries, alerts and scenarios
     * as well as what is on screen — and falls back to assembling the blob from
     * loaded state, which is all the page can offer if the request fails.
     */
    async function exportData(): Promise<void> {
      let payload: unknown;
      try {
        payload = await request(api.GET('/state/export'), 'GET', '/state/export');
      } catch (err) {
        console.warn('[dashboard] server export failed, falling back to a local snapshot:', err);
        payload = {
          trades: trades.value,
          history: history.value,
          cashReais: cashReais.value,
          cashDollars: cashDollars.value,
          interestReais: interestReais.value,
          interestDollars: interestDollars.value,
          interestReaisMonths: interestReaisMonths.value,
        };
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'portfolio_data.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);
    }

    async function importData(file: File): Promise<string | null> {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(await file.text()) as Record<string, unknown>;
      } catch {
        return 'Invalid JSON.';
      }
      if (!Array.isArray(parsed.trades) || !Array.isArray(parsed.history)) return 'Invalid file format.';

      try {
        await request(api.POST('/state/import', { body: parsed }), 'POST', '/state/import');
      } catch (err) {
        console.warn('[dashboard] import failed:', err);
        return err instanceof ApiError ? err.message : 'Server import failed';
      }
      await reloadState();
      return 'Data imported to server!';
    }

    async function runMaintenance(key: string, path: string): Promise<void> {
      busyMigration.value = key;
      maintenanceLog.value[key] = `Calling ${path}…`;
      try {
        // Maintenance endpoints answer with a progress report whose shape is
        // route-specific, so this one stays on `fetch` rather than pretending
        // the typed client knows it.
        const res = await fetch(path, { method: 'POST' });
        maintenanceLog.value[key] = JSON.stringify(await res.json(), null, 2);
      } catch (err) {
        maintenanceLog.value[key] = `Error: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        busyMigration.value = null;
      }
    }

    async function testNotify(message: string): Promise<string | null> {
      try {
        await request(
          api.POST('/alerts/test-notify', { body: { title: 'Portfolio Test Notification', message } }),
          'POST',
          '/alerts/test-notify',
        );
        return null;
      } catch (err) {
        console.warn('[dashboard] test notify failed:', err);
        return err instanceof ApiError ? err.message : 'Notification failed';
      }
    }

    // --- Loading ---------------------------------------------------------------

    async function loadSymbols(): Promise<void> {
      if (symbolList.value.length > 0) return;
      const data = await request(api.GET('/config/symbols'), 'GET', '/config/symbols');
      if (data) {
        symbolList.value = data.all ?? [];
        symbolDetails.value = (data.detailed ?? {}) as SymbolMap;
        currencySymbols.value = data.currencies ?? [];
      } else {
        // Fall back to the vanilla page's defaults so the form is still usable.
        symbolList.value = ['BTC', 'ETH', 'SOL', 'SPY', 'GLD', 'IBIT', 'BRLUSD'];
        symbolDetails.value = {};
        currencySymbols.value = ['BRLUSD'];
      }
    }

    async function fetchPrices(): Promise<void> {
      priceError.value = null;
      const data = await request(api.GET('/prices'), 'GET', '/prices');
      const nextPrices: Record<string, number> = {};
      const nextMeta: Record<string, PriceMeta> = {};
      const nextTs: Record<string, number> = {};
      let ttl = 600_000;

      for (const [key, value] of Object.entries(data ?? {})) {
        if (key === 'cacheTTLms') {
          ttl = Number(value) || ttl;
          continue;
        }
        if (key.endsWith('_meta')) {
          nextMeta[key.slice(0, -5)] = value as PriceMeta;
          continue;
        }
        if (key.endsWith('_ts')) {
          nextTs[key.slice(0, -3)] = Number(value);
          continue;
        }
        nextPrices[key] = value as number;
      }

      prices.value = nextPrices;
      priceMeta.value = nextMeta;
      priceTimestamps.value = nextTs;
      cacheTtlMs.value = ttl;
      if (typeof nextPrices.BRLUSD === 'number') brlUsdRate.value = nextPrices.BRLUSD;
      if (typeof nextPrices.CDI === 'number') cdiRate.value = nextPrices.CDI;

      // Prices are cached server-side with a TTL; flag anything past it.
      const stale: string[] = [];
      for (const s of symbolList.value.length > 0 ? symbolList.value : Object.keys(nextPrices)) {
        const ts = nextTs[s];
        const value = nextPrices[s];
        if (ts === undefined || ts === null) {
          if (value === undefined || value === 0) stale.push(`${s} (no timestamp)`);
        } else if (Date.now() - ts > ttl) {
          stale.push(`${s} (${Math.round((Date.now() - ts) / 60000)}m)`);
        }
      }
      staleWarning.value = stale.length > 0 ? `Price may be stale for: ${stale.join(', ')}. Displaying cached values.` : null;

      const zeroed = Object.keys(nextPrices).filter((k) => nextPrices[k] == null || nextPrices[k] === 0);
      if (zeroed.length > 0) {
        priceError.value = `Price for ${zeroed.join(', ')} is 0. This usually means the price could not be fetched.`;
      }
    }

    /**
     * Trades, cash and interest, read from the granular endpoints.
     *
     * Phase 5 retired the `GET /api/state` aggregation: `/trades` carries the
     * ledger, `/cash` already sums both balances *and* both interest totals,
     * and the two `/interest/months` calls carry the month lists. Four small
     * queries instead of one cached blob, and no endpoint that duplicates what
     * the routes already say.
     */
    async function reloadState(): Promise<void> {
      const [tradeRows, cash, brlMonths, usdMonths] = await Promise.all([
        request(api.GET('/trades'), 'GET', '/trades'),
        request(api.GET('/cash'), 'GET', '/cash'),
        request(api.GET('/interest/months', { params: { query: { currency: 'BRL' } } }), 'GET', '/interest/months'),
        request(api.GET('/interest/months', { params: { query: { currency: 'USD' } } }), 'GET', '/interest/months'),
      ]);

      trades.value = (tradeRows ?? [])
        .filter((t) => Boolean(t.symbol) && typeof t.qty === 'number')
        .map(normalizeTrade);

      cashReais.value = Number(cash?.cashReais) || 0;
      cashDollars.value = Number(cash?.cashDollars) || 0;
      interestReais.value = Number(cash?.interestReais) || 0;
      interestDollars.value = Number(cash?.interestDollars) || 0;
      interestReaisMonths.value = (brlMonths ?? []) as InterestMonth[];
      interestDollarsMonths.value = (usdMonths ?? []) as InterestMonth[];
    }

    async function loadHistorySeries(): Promise<void> {
      const rows = await request(api.GET('/history', { params: { query: { range: 'all' } } }), 'GET', '/history');
      if (Array.isArray(rows)) history.value = rows;

      const [valueCandles, pnlCandles] = await Promise.all([
        request(api.GET('/history/ohlc', { params: { query: { range: 'all', metric: 'value' } } }), 'GET', '/history/ohlc'),
        request(api.GET('/history/ohlc', { params: { query: { range: 'all', metric: 'pnl' } } }), 'GET', '/history/ohlc'),
      ]);

      if (Array.isArray(valueCandles) && valueCandles.length > 0) historyOHLC.value = valueCandles;
      else if (history.value.length > 0) {
        historyOHLC.value = history.value.map((h) => ({ ts: h.ts ?? 0, open: h.v ?? 0, high: h.v ?? 0, low: h.v ?? 0, close: h.v ?? 0 }));
      }
      if (Array.isArray(pnlCandles) && pnlCandles.length > 0) pnlOHLC.value = pnlCandles;
    }

    /** One cycle of the legacy `refresh()`: symbols, prices, history. */
    async function refresh(): Promise<void> {
      await loadSymbols();
      await fetchPrices();
      await loadHistorySeries();
    }

    async function load(): Promise<void> {
      loading.value = true;
      try {
        await Promise.all([reloadState(), loadSymbols()]);
        await refresh();
        await Promise.all([loadAlerts(), loadTriggeredAlerts(), loadCashEntries()]);
        if (!tradeDate.value) tradeDate.value = new Date().toISOString().slice(0, 10);
      } catch (err) {
        // One failed call must not blank the page: whatever loaded stays on
        // screen, and the log names the endpoint that failed.
        console.warn('[dashboard] load failed:', err);
        priceError.value = err instanceof ApiError ? err.message : 'Could not load the dashboard';
      } finally {
        loading.value = false;
      }
    }

    // --- UI actions ------------------------------------------------------------

    function setTab(next: Tab): void {
      tab.value = next;
    }

    function setAllocationMode(mode: 'withCash' | 'investments'): void {
      allocationShowCash.value = mode === 'withCash';
    }

    function setAllocCurrency(next: Currency): void {
      allocCurrency.value = next;
    }

    function setMetric(series: 'all' | 'value' | 'pnl'): void {
      activeSeries.value = series;
    }

    function toggleProjection(): void {
      projectionEnabled.value = !projectionEnabled.value;
    }

    function setChartDays(days: number): void {
      selectedDays.value = days;
    }

    return {
      // server data
      prices,
      priceMeta,
      trades,
      history,
      historyOHLC,
      pnlOHLC,
      cashReais,
      cashDollars,
      interestReais,
      interestDollars,
      interestReaisMonths,
      interestDollarsMonths,
      cdiRate,
      brlUsdRate,
      symbolList,
      symbolDetails,
      currencySymbols,
      // preferences
      allocationShowCash,
      allocCurrency,
      interestMonthsCollapsed,
      interestUSDMonthsCollapsed,
      // ui
      tab,
      activeSeries,
      activeMetric,
      projectionEnabled,
      selectedDays,
      entryCurrency,
      cashEntries,
      cashEntriesPage,
      cashEntriesPages,
      cashEntryRows,
      alerts,
      triggeredAlerts,
      alertRows,
      triggeredRows,
      priceError,
      staleWarning,
      settingsOpen,
      eraseOpen,
      deleteTradeIndex,
      maintenanceLog,
      busyMigration,
      loading,
      // form
      formSide,
      formSymbol,
      formCashSource,
      qtyInput,
      priceInput,
      tradeDate,
      totalInput,
      qtyPct,
      // derived
      tradeableSymbols,
      lots,
      positions,
      investedWithCash,
      totalValue,
      metrics,
      hasPriceError,
      zeroPriceAssets,
      positionRows,
      cashPositionRows,
      tradeRows,
      allocation,
      plByAsset,
      projection,
      valueCandles,
      // helpers
      isBRLAsset,
      isBRLNonBond,
      isBRLBond,
      priceOf,
      usd,
      brl,
      signedUsd,
      signedBrl,
      totalFromQty,
      qtyFromTotal,
      qtyFromPct,
      pctFromQty,
      resolvedTradePrice,
      // actions
      load,
      refresh,
      reloadState,
      fetchPrices,
      addTrade,
      requestDeleteTrade,
      confirmDeleteTrade,
      addInterestMonth,
      deleteInterestMonth,
      loadCashEntries,
      addCashEntry,
      deleteCashEntry,
      loadAlerts,
      loadTriggeredAlerts,
      createAlert,
      deleteAlert,
      dismissAlert,
      clearHistory,
      eraseAll,
      exportData,
      importData,
      runMaintenance,
      testNotify,
      setTab,
      setAllocationMode,
      setAllocCurrency,
      setMetric,
      toggleProjection,
      setChartDays,
      setQty,
      setQtyPct,
      setPrice,
      setTotal,
      syncPriceToSymbol,
      setFormSide,
      setCashSource,
      resetTradeForm,
    };
  },
  { persist: ['allocationShowCash', 'allocCurrency', 'interestMonthsCollapsed', 'interestUSDMonthsCollapsed'] },
);
