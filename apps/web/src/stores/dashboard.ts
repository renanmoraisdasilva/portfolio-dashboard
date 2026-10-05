import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  computeProjection,
  createSymbolClassifier,
  formatMoney,
  formatSigned,
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
export type PortfolioValuation = components['schemas']['PortfolioValuation'];

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

interface ImportProblem {
  table: string;
  index: number | null;
  reason: string;
}

const MAX_RENDERED_PROBLEMS = 6;

export function importErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details as { problems?: unknown; omitted?: unknown } | null;
  const problems = Array.isArray(details?.problems) ? (details.problems as ImportProblem[]) : null;
  if (err.status !== 400 || !problems?.length) return err.message;

  const shown = problems.slice(0, MAX_RENDERED_PROBLEMS);
  const lines = shown.map((p) => `${p.index === null ? p.table : `${p.table}[${p.index}]`}: ${p.reason}`);
  const omitted = typeof details?.omitted === 'number' ? details.omitted : 0;
  const notShown = problems.length - shown.length + omitted;
  if (notShown > 0) lines.push(`…and ${notShown} more`);

  const total = problems.length + omitted;
  return [`Backup rejected — ${total} problem${total === 1 ? '' : 's'}:`, ...lines].join('\n');
}

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

const CASH_ENTRIES_PAGE_SIZE = 5;

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

    const allocationShowCash = ref(true);
    const allocCurrency = ref<Currency>('USD');
    const interestMonthsCollapsed = ref(true);
    const interestUSDMonthsCollapsed = ref(true);

    const tab = ref<Tab>('dashboard');
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
    const deleteTradeIndex = ref<number | null>(null);
    const loading = ref(false);

    const formSide = ref<Side>('buy');
    const formSymbol = ref('BTC');
    const formCashSource = ref<CashSource>('USD');
    const qtyInput = ref('');
    const priceInput = ref('');
    const tradeDate = ref('');
    const totalInput = ref('');
    const qtyPct = ref(0);

    const classifier = computed(() => createSymbolClassifier(symbolDetails.value));
    const isBRLAsset = (s: string): boolean => classifier.value.isBRLAsset(s);
    const isBRLNonBond = (s: string): boolean => classifier.value.isBRLNonBond(s);
    const isBRLBond = (s: string): boolean => classifier.value.isBRLBond(s);

    const positionQty = (symbol: string): number => valuation.value?.positions?.[symbol] ?? 0;

    const tradeableSymbols = computed(() =>
      symbolList.value.filter((s) => symbolDetails.value[s] && symbolDetails.value[s]?.type !== 'currency'),
    );

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

    function qtyFromPct(pct: number): number {
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return 0;

      if (formSide.value === 'sell') {
        const pos = positionQty(symbol);
        return +((pos * pct) / 100).toFixed(4);
      }
      const source = formCashSource.value;
      if (isBRLNonBond(symbol)) {
        const availBRL = source === 'USD' ? cashDollars.value / (brlUsdRate.value || 1) : cashReais.value;
        return +((availBRL * pct) / 100 / price).toFixed(4);
      }
      const availableUsd = source === 'USD' ? cashDollars.value : cashReais.value * brlUsdRate.value;
      return +((availableUsd * (pct / 100)) / price).toFixed(4);
    }

    function pctFromQty(qty: number): number {
      const symbol = formSymbol.value;
      const price = parsedPrice.value || priceOf(symbol);
      if (!price || price <= 0) return 0;

      if (formSide.value === 'sell') {
        const pos = positionQty(symbol);
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
        parsed && parsed > 0 ? (formCashSource.value === 'USD' ? formatMoney(parsed, 'USD') : formatMoney(parsed, 'BRL')) : text;
      const qty = qtyFromTotal();
      if (qty) qtyInput.value = qty;
    }

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
          : brlUsdRate.value > 0
            ? priceOf(s) / brlUsdRate.value
            : 0;
      priceInput.value = brlPrice > 0 ? brlPrice.toFixed(2) : '';
      totalInput.value = totalFromQty();
      qtyPct.value = pctFromQty(parsedQty.value);
    }

    function setFormSide(side: Side): void {
      formSide.value = side;
      totalInput.value = totalFromQty();
      qtyPct.value = pctFromQty(parsedQty.value);
    }

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

    function resolvedTradePrice(): number | null {
      const typed = priceInput.value ? parseFloat(priceInput.value) : null;
      const s = formSymbol.value;
      if (isBRLBond(s)) {
        const brlP =
          typed !== null
            ? typed
            : typeof priceMeta.value[s]?.priceBRL === 'number'
              ? priceMeta.value[s].priceBRL
              : brlUsdRate.value > 0
                ? priceOf(s) / brlUsdRate.value
                : null;
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

    async function addInterestMonth(currency: Currency, month: string, raw: string): Promise<string | null> {
      const amount = +parseMoney(raw, currency).toFixed(2) || 0;
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
        await request(
          api.POST('/cash/entries', { body: { currency: entryCurrency.value, amount, ts } }),
          'POST',
          '/cash/entries',
        );
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

    const alertRows = computed(() =>
      alerts.value.map((a) => {
        const brl = isBRLAsset(a.symbol ?? '');
        const money = (amount: number): string => formatMoney(amount, brl ? 'BRL' : 'USD');
        const threshold = a.threshold ?? 0;
        const label =
          a.alert_type === 'value'
            ? `${a.condition === 'below' ? 'Falls Below' : 'Rises Above'} ${money(threshold)}`
            : `${a.condition === 'below' ? 'Down' : 'Up'} ${threshold.toFixed(2)}% from ${money(a.reference_price ?? 0)}`;
        return { id: a.id ?? '', symbol: a.symbol ?? '', label, isActive: Boolean(a.is_active) };
      }),
    );

    const triggeredRows = computed(() =>
      triggeredAlerts.value.map((t) => {
        const brl = isBRLAsset(t.symbol ?? '');
        const money = (amount: number, maxDigits?: number): string => formatMoney(amount, brl ? 'BRL' : 'USD', maxDigits);
        const current = t.current_price ?? 0;
        const priceText =
          t.alert_type === 'value' ? money(current) : `${t.percentage_change ? t.percentage_change.toFixed(2) : '0'}%`;
        const details =
          t.previous_price && t.percentage_change
            ? `from ${money(t.previous_price)} to ${money(current)} (${t.percentage_change.toFixed(2)}% change)`
            : `Currently at ${money(current)}`;
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        return 'Invalid JSON.';
      }

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Not a backup file.';

      try {
        await request(api.POST('/state/import', { body: parsed }), 'POST', '/state/import');
      } catch (err) {
        console.warn('[dashboard] import failed:', err);
        return importErrorMessage(err);
      }
      await reloadState();
      return 'Data imported to server!';
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
