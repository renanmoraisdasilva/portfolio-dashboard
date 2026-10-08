import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  computeProjection,
  createSymbolClassifier,
  formatMoney,
  formatSigned,
  type SymbolMap,
} from '@portfolio-dashboard/shared';
import { ApiError, request, useApi } from '../composables/useApi';
import { useAlerts } from '../composables/useAlerts';
import { useCashflow, type InterestMonth } from '../composables/useCashflow';
import { useSettings } from '../composables/useSettings';
import { useTradeForm } from '../composables/useTradeForm';

export type Trade = components['schemas']['Trade'];
export type CashEntry = components['schemas']['CashEntry'];
export type { Alert, TriggeredAlert } from '../composables/useAlerts';
export type OhlcCandle = components['schemas']['OhlcCandle'];
export type HistoryPoint = components['schemas']['HistoryPoint'];
export type SymbolMeta = components['schemas']['SymbolConfig'];
export type PortfolioValuation = components['schemas']['PortfolioValuation'];

export type Side = 'buy' | 'sell';
export type CashSource = 'USD' | 'BRL';
export type Currency = 'USD' | 'BRL';
export type Metric = 'value' | 'pnl';
export type Tab = 'dashboard' | 'assetCharts';

export type { InterestMonth };

export interface PriceMeta {
  priceBRL?: number;
  taxaCompra?: number;
}

export interface DashboardTrade {
  id?: string;
  symbol: string;
  side: Side;
  qty: number;
  price?: number | null;
  profit?: number;
  time: string;
  _tmpId?: string;
}

// The import formatter lives with the import tool; re-exported here because
// `dashboard.import.test.ts` has always imported it from this module.
export { importErrorMessage } from '../composables/useSettings';

export const ALLOCATION_PALETTE = [
  '#dc2626',
  '#15803d',
  '#0891b2',
  '#1e40af',
  '#7c3aed',
  '#d97706',
  '#06b6d4',
  '#22c55e',
  '#f97316',
  '#eab308',
  '#a855f7',
  '#3b82f6',
];

const usd = (n: number): string => formatMoney(n, 'USD');
const brl = (n: number): string => formatMoney(n, 'BRL');
const signedUsd = (n: number): string => formatSigned(n, 'USD');

function legacyAmount(amount: number, currency: Currency): string {
  return `${currency === 'BRL' ? 'R$' : '$'}${Math.abs(amount).toFixed(2)}`;
}

function legacySigned(amount: number, currency: Currency): string {
  return `${amount < 0 ? '-' : '+'}${legacyAmount(amount, currency)}`;
}

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

export const useDashboardStore = defineStore(
  'dashboard',
  () => {
    const api = useApi();

    const prices = ref<Record<string, number>>({});
    const priceMeta = ref<Record<string, PriceMeta>>({});
    const priceTimestamps = ref<Record<string, number>>({});
    const cacheTtlMs = ref(1_440_000);
    const trades = ref<DashboardTrade[]>([]);
    const history = ref<HistoryPoint[]>([]);
    const historyOHLC = ref<OhlcCandle[]>([]);
    const pnlOHLC = ref<OhlcCandle[]>([]);
    const brlUsdRate = ref(0);
    const symbolList = ref<string[]>([]);
    const symbolDetails = ref<SymbolMap>({});
    const currencySymbols = ref<string[]>([]);

    const allocationShowCash = ref(true);
    const allocCurrency = ref<Currency>('USD');

    const tab = ref<Tab>('dashboard');
    const activeSeries = ref<'all' | 'value' | 'pnl'>('value');
    const activeMetric = computed<Metric>(() => (activeSeries.value === 'pnl' ? 'pnl' : 'value'));
    const projectionEnabled = ref(false);
    const selectedDays = ref(60);
    const priceError = ref<string | null>(null);
    const staleWarning = ref<string | null>(null);
    const deleteTradeIndex = ref<number | null>(null);
    const loading = ref(false);

    const classifier = computed(() => createSymbolClassifier(symbolDetails.value));
    const isBRLAsset = (s: string): boolean => classifier.value.isBRLAsset(s);
    const isBRLNonBond = (s: string): boolean => classifier.value.isBRLNonBond(s);
    const isBRLBond = (s: string): boolean => classifier.value.isBRLBond(s);

    const positionQty = (symbol: string): number => valuation.value?.positions?.[symbol] ?? 0;

    const tradeableSymbols = computed(() =>
      symbolList.value.filter((s) => symbolDetails.value[s] && symbolDetails.value[s]?.type !== 'currency'),
    );

    /**
     * The trade form — state, setters and the delegation to the shared
     * arithmetic in `packages/shared/src/domain/tradeForm.ts`. Destructured
     * so the rest of this store (and its return block) refers to these names
     * exactly as before; the refs are the same objects the components bind.
     */
    const {
      formSide,
      formSymbol,
      formCashSource,
      qtyInput,
      priceInput,
      tradeDate,
      totalInput,
      qtyPct,
      totalFromQty,
      qtyFromTotal,
      qtyFromPct,
      pctFromQty,
      setQty,
      setQtyPct,
      setPrice,
      setTotal,
      syncPriceToSymbol,
      setFormSide,
      setCashSource,
      resolvedTradePrice,
      resetTradeForm,
    } = useTradeForm({
      classifier: () => classifier.value,
      brlUsdRate: () => brlUsdRate.value,
      cashUsd: () => cashDollars.value,
      cashBrl: () => cashReais.value,
      positionQty,
      prices: () => prices.value,
      priceMeta: () => priceMeta.value,
    });

    /**
     * Alerts and the settings modal's three tools — the second 4.1 slice,
     * the same shape as the trade form above: state and actions defined in
     * their own composable, destructured under the old names so nothing
     * downstream changes.
     */
    const {
      alerts,
      triggeredAlerts,
      alertRows,
      triggeredRows,
      loadAlerts,
      loadTriggeredAlerts,
      createAlert,
      deleteAlert,
      dismissAlert,
    } = useAlerts({ classifier: () => classifier.value });

    const { settingsOpen, exportData, importData, testNotify } = useSettings({
      fallbackSnapshot: () => ({
        trades: trades.value,
        history: history.value,
        cashReais: cashReais.value,
        cashDollars: cashDollars.value,
        interestReais: interestReais.value,
        interestDollars: interestDollars.value,
        interestReaisMonths: interestReaisMonths.value,
      }),
      afterImport: () => reloadState(),
    });

    /**
     * Cash balances, the interest ledgers and the cash-entry log — the third
     * 4.1 slice. `reloadState` and `fetchPrices` keep writing into these refs
     * (they come back from the same destructure), and only the post-write
     * reload crosses back into this store.
     */
    const {
      cashReais,
      cashDollars,
      interestReais,
      interestDollars,
      interestReaisMonths,
      interestDollarsMonths,
      cdiRate,
      interestMonthsCollapsed,
      interestUSDMonthsCollapsed,
      entryCurrency,
      cashEntries,
      cashEntriesPage,
      cashEntriesPages,
      cashEntryRows,
      loadCashEntries,
      addCashEntry,
      deleteCashEntry,
      addInterestMonth,
      deleteInterestMonth,
    } = useCashflow({ afterWrite: () => reloadState() });

    const priceOf = (s: string): number => prices.value[s] ?? 0;

    function normalizeTrade(t: Trade): DashboardTrade {
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

    const valuation = ref<PortfolioValuation | null>(null);

    async function loadValuation(): Promise<void> {
      valuation.value = await request(
        api.GET('/portfolio/valuation', {
          params: { query: { cash: allocationShowCash.value ? 'with-cash' : 'investments' } },
        }),
        'GET',
        '/portfolio/valuation',
      );
    }

    const metrics = computed(() => {
      const v = valuation.value;
      const total = v?.total ?? 0;
      const invested = v?.invested ?? 0;
      return {
        total,
        invested,
        investedNet: v?.investedNet ?? 0,
        realized: v?.realized ?? 0,
        unrealized: v?.unrealized ?? 0,
        unrealizedPct: v?.unrealizedPct ?? 0,
        tickerValue: v?.tickerValue ?? 0,
        investedPct: v?.investedPct ?? 0,
        investedShareOfTotal: total > 0 ? (invested / total) * 100 : 0,
        breakEven: v?.breakEven ?? true,
        salesCount: v?.salesCount ?? 0,
      };
    });

    const zeroPriceAssets = computed(() =>
      Object.keys(prices.value).filter((k) => prices.value[k] == null || prices.value[k] === 0),
    );
    const hasPriceError = computed(() => priceError.value !== null || zeroPriceAssets.value.length > 0);

    const positionRows = computed(() =>
      (valuation.value?.rows ?? [])
        .filter((row) => row.kind === 'position')
        .map((row) => {
          const brl = row.valueCurrency === 'BRL';
          const money = (amount: number): string => legacyAmount(amount, brl ? 'BRL' : 'USD');
          const pl = legacySigned(row.pl, row.plCurrency);
          return {
            symbol: row.symbol,
            qty: row.qty.toFixed(4),
            avg: money(row.avgCost),
            cur: money(row.currentPrice),
            value: money(row.value),
            pl,
            plPct: `${row.plPct >= 0 ? '+' : ''}${row.plPct.toFixed(2)}%`,
            positive: row.pl >= 0,
          };
        }),
    );

    const cashPositionRows = computed(() =>
      (valuation.value?.rows ?? [])
        .filter((row) => row.kind !== 'position')
        .map((row) => ({
          symbol: row.symbol,
          qty: row.qty.toFixed(2),
          avg: row.kind === 'brl-cash' ? `$${row.avgCost.toFixed(4)}` : '-',
          cur: row.kind === 'brl-cash' ? `$${row.currentPrice.toFixed(4)}` : '-',
          value: `$${row.value.toFixed(2)}`,
          pl: legacySigned(row.pl, row.plCurrency),
          plPct: `${row.plPct >= 0 ? '+' : ''}${row.plPct.toFixed(2)}%`,
          positive: row.pl >= 0,
        })),
    );

    const allocation = computed(() => {
      const slices = valuation.value?.allocation ?? [];
      return {
        labels: slices.map((slice) => slice.label),
        values: slices.map((slice) => slice.value),
        pcts: slices.map((slice) => slice.pct),
        colors: slices.map((_, i) => ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length]),
      };
    });

    const plByAsset = computed(() => {
      const rows = valuation.value?.plByAsset ?? [];
      return {
        labels: rows.map((row) => row.symbol),
        values: rows.map((row) => row.pl),
        colors: rows.map((row) => (row.pl >= 0 ? '#10b981' : '#ef4444')),
      };
    });

    const projection = computed(() => (projectionEnabled.value ? computeProjection(history.value) : []));

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
            profit = { text: formatSigned(t.profit, 'BRL'), positive: t.profit >= 0 };
          }
        } else if (isBRLBond(symbol)) {
          const rawUSD = t.price || priceOf(symbol);
          const rawBRL = rawUSD / rate;
          price = t.price !== null && t.price !== undefined ? formatMoney(rawBRL, 'BRL') : '-';
          total = formatMoney(t.qty * rawBRL, 'BRL');
          profit = { text: '-', positive: null };
          if (t.side === 'sell' && typeof t.profit === 'number') {
            const profitBRL = t.profit / rate;
            profit = { text: formatSigned(profitBRL, 'BRL'), positive: profitBRL >= 0 };
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

    async function loadSymbols(): Promise<void> {
      if (symbolList.value.length > 0) return;
      const data = await request(api.GET('/config/symbols'), 'GET', '/config/symbols');
      if (data) {
        symbolList.value = data.all ?? [];
        symbolDetails.value = (data.detailed ?? {}) as SymbolMap;
        currencySymbols.value = data.currencies ?? [];
      } else {
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
      let ttl = 1_440_000;

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

    async function reloadState(): Promise<void> {
      const [tradeRows, cash, brlMonths, usdMonths] = await Promise.all([
        request(api.GET('/trades'), 'GET', '/trades'),
        request(api.GET('/cash'), 'GET', '/cash'),
        request(api.GET('/interest/months', { params: { query: { currency: 'BRL' } } }), 'GET', '/interest/months'),
        request(api.GET('/interest/months', { params: { query: { currency: 'USD' } } }), 'GET', '/interest/months'),
      ]);

      trades.value = (tradeRows ?? []).filter((t) => Boolean(t.symbol) && typeof t.qty === 'number').map(normalizeTrade);

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
        historyOHLC.value = history.value.map((h) => ({
          ts: h.ts ?? 0,
          open: h.v ?? 0,
          high: h.v ?? 0,
          low: h.v ?? 0,
          close: h.v ?? 0,
        }));
      }
      if (Array.isArray(pnlCandles) && pnlCandles.length > 0) pnlOHLC.value = pnlCandles;
    }

    async function refresh(): Promise<void> {
      await loadSymbols();
      await fetchPrices();
      await loadHistorySeries();
      await loadValuation();
    }

    async function load(): Promise<void> {
      loading.value = true;
      try {
        await Promise.all([reloadState(), loadSymbols()]);
        await refresh();
        await Promise.all([loadAlerts(), loadTriggeredAlerts(), loadCashEntries()]);
        if (!tradeDate.value) tradeDate.value = new Date().toISOString().slice(0, 10);
      } catch (err) {
        console.warn('[dashboard] load failed:', err);
        priceError.value = err instanceof ApiError ? err.message : 'Could not load the dashboard';
      } finally {
        loading.value = false;
      }
    }

    function setTab(next: Tab): void {
      tab.value = next;
    }

    function setAllocationMode(mode: 'withCash' | 'investments'): void {
      if (allocationShowCash.value === (mode === 'withCash')) return;
      allocationShowCash.value = mode === 'withCash';
      loadValuation().catch((err) => console.warn('[dashboard] allocation valuation failed:', err));
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
      allocationShowCash,
      allocCurrency,
      interestMonthsCollapsed,
      interestUSDMonthsCollapsed,
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
      deleteTradeIndex,
      loading,
      formSide,
      formSymbol,
      formCashSource,
      qtyInput,
      priceInput,
      tradeDate,
      totalInput,
      qtyPct,
      tradeableSymbols,
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
      isBRLAsset,
      isBRLNonBond,
      isBRLBond,
      priceOf,
      usd,
      brl,
      signedUsd,
      totalFromQty,
      qtyFromTotal,
      qtyFromPct,
      pctFromQty,
      resolvedTradePrice,
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
      exportData,
      importData,
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
