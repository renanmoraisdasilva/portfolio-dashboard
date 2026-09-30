import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import { computePnlReturns, stdDev } from '@portfolio-dashboard/shared';
import { useApi, ApiError, request } from '../composables/useApi';

export type AnalyticsSnapshot = components['schemas']['AnalyticsSnapshot'];
export type HistoryPoint = components['schemas']['HistoryPoint'];
export type CashEntry = components['schemas']['CashEntry'];

/** `cost_vs_market_json` once parsed. */
export interface CostVsMarket {
  [symbol: string]: { cost: number; market: number };
}

/** Everything the cash panels need about the current cash balance. */
export interface CashContext {
  cashUSD: number;
  cashBRL: number;
  cashUSDNative: number;
  brlUsd: number;
}

export const EMERGENCY_FUND_USD = 50_000;

export const CASH_CHART_MODE = {
  ASSETS_CASH: 'assets-cash',
  CASH_CURRENCIES: 'cash-currencies',
} as const;
export type CashChartMode = (typeof CASH_CHART_MODE)[keyof typeof CASH_CHART_MODE];

/**
 * `3M` maps to `6months` — the legacy Analytics Lab did the same, so the
 * period buttons keep showing the same window.
 */
export const PERIODS = [
  { id: '1W', range: 'week' },
  { id: '1M', range: 'month' },
  { id: '3M', range: '6months' },
  { id: '1Y', range: 'year' },
  { id: 'ALL', range: 'all' },
] as const;

export type PeriodId = (typeof PERIODS)[number]['id'];

function parseCostVsMarket(json: string | null | undefined): CostVsMarket {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as CostVsMarket) : {};
  } catch {
    return {};
  }
}

/**
 * Analytics Lab state.
 *
 * The legacy page fetched all five period snapshots in one request and only
 * refetched history when the period changed, so the store keeps that shape:
 * switching period is instant for the cards and refetches only the chart
 * series.
 *
 * Cash and prices are fetched once and cached — they do not depend on period.
 */
export const useAnalyticsStore = defineStore('analytics', () => {
  const api = useApi();

  const period = ref<PeriodId>('3M');
  const snapshots = ref<Record<string, AnalyticsSnapshot | undefined>>({});
  const history = ref<HistoryPoint[]>([]);
  const cashContext = ref<CashContext | null>(null);
  const cashEntries = ref<CashEntry[]>([]);
  const cashChartMode = ref<CashChartMode>(CASH_CHART_MODE.ASSETS_CASH);
  const online = ref(false);
  const loading = ref(false);
  const loadingHistory = ref(false);
  const error = ref<string | null>(null);

  const active = computed<AnalyticsSnapshot | null>(() => snapshots.value[period.value] ?? null);
  const range = computed(() => PERIODS.find((p) => p.id === period.value)?.range ?? 'all');
  const costVsMarket = computed(() => parseCostVsMarket(active.value?.cost_vs_market_json));

  const assetsUSD = computed(() => Object.values(costVsMarket.value).reduce((sum, row) => sum + (Number(row.market) || 0), 0));
  const cashUSD = computed(() => Number(cashContext.value?.cashUSD ?? 0));
  const totalUSD = computed(() => assetsUSD.value + cashUSD.value);
  const cashPct = computed(() => (totalUSD.value > 0 ? (cashUSD.value / totalUSD.value) * 100 : 0));
  const deployableCashUSD = computed(() => Math.max(0, cashUSD.value - EMERGENCY_FUND_USD));
  const deployableCashPct = computed(() => (totalUSD.value > 0 ? (deployableCashUSD.value / totalUSD.value) * 100 : 0));
  const emergencyCoverage = computed(() => (EMERGENCY_FUND_USD > 0 ? cashUSD.value / EMERGENCY_FUND_USD : 0));
  const maxAssetAllocPct = computed(() => {
    const rows = Object.values(costVsMarket.value).map((row) => Number(row.market) || 0);
    if (!assetsUSD.value) return 0;
    return Math.max(...rows.map((market) => (market / assetsUSD.value) * 100));
  });
  const pnlStdPct = computed(() => stdDev(computePnlReturns(history.value)) * 100);

  /** One-shot load: snapshots, then the period-independent cash context. */
  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;

    // `/cash` returns both balances and both interest totals in one query; the
    // month lists are not needed here. `/api/state` was retired.
    try {
      const [snapshotsPayload, state, prices, entries] = await Promise.all([
        request(api.GET('/analytics'), 'GET', '/analytics'),
        request(api.GET('/cash'), 'GET', '/cash'),
        request(api.GET('/prices'), 'GET', '/prices'),
        request(api.GET('/cash/entries'), 'GET', '/cash/entries'),
      ]);

      if (!snapshotsPayload || !Array.isArray(snapshotsPayload.snapshots)) {
        throw new ApiError('GET', '/analytics', 200, 'Malformed payload: snapshots missing');
      }

      const next: Record<string, AnalyticsSnapshot> = {};
      for (const snap of snapshotsPayload.snapshots) {
        if (snap.period) next[snap.period] = snap as AnalyticsSnapshot;
      }
      snapshots.value = next;
      online.value = true;

      if (state && prices) {
        const brlUsd = typeof prices.BRLUSD === 'number' ? prices.BRLUSD : 1;
        const cashBRL = Number(state.cashReais) || 0;
        const cashUSDNative = Number(state.cashDollars) || 0;
        cashContext.value = {
          cashUSD: cashUSDNative + cashBRL * brlUsd,
          cashBRL,
          cashUSDNative,
          brlUsd,
        };
      } else {
        cashContext.value = null;
      }

      cashEntries.value = Array.isArray(entries) ? entries : [];
    } catch (err) {
      online.value = false;
      error.value = err instanceof ApiError ? err.message : 'Could not load analytics';
      console.warn('[analytics] load failed:', err);
    } finally {
      loading.value = false;
    }
  }

  /** Refetches only the chart series for the new window. */
  async function selectPeriod(id: PeriodId): Promise<void> {
    period.value = id;
    loadingHistory.value = true;
    try {
      const points = await request(api.GET('/history', { params: { query: { range: range.value } } }), 'GET', '/history');
      history.value = Array.isArray(points) ? points : [];
    } catch (err) {
      // A failed window refresh leaves the previous series on screen; the page
      // stays usable and the status dot already reflects the failed load.
      console.warn('[analytics] history refresh failed:', err);
    } finally {
      loadingHistory.value = false;
    }
  }

  function setCashChartMode(mode: CashChartMode): void {
    cashChartMode.value = mode;
  }

  return {
    period,
    snapshots,
    history,
    cashContext,
    cashEntries,
    cashChartMode,
    online,
    loading,
    loadingHistory,
    error,
    active,
    range,
    costVsMarket,
    assetsUSD,
    cashUSD,
    totalUSD,
    cashPct,
    deployableCashUSD,
    deployableCashPct,
    emergencyCoverage,
    maxAssetAllocPct,
    pnlStdPct,
    load,
    selectPeriod,
    setCashChartMode,
  };
});
