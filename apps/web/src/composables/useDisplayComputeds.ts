import { computed } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import { computeProjection, formatMoney, formatSigned, type Currency, type SymbolClassifier } from '@portfolio-dashboard/shared';

/**
 * The dashboard's view-models: the computeds that turn stored server state
 * into what the components render — the metric cards, the position and cash
 * tables, the allocation and P/L chart data, the trade-history rows, the
 * chart candles and the trend projection. Extracted from
 * `stores/dashboard.ts` as the follow-up cut after 4.1.
 *
 * Every member here is a pure `computed`: no API call, no reload, no write to
 * any ref. The only coupling to the owning store is the eleven getters below,
 * so this is the lowest-risk slice of the file — and the store destructures
 * the results under the exact names its return block (and the `.vue`
 * consumers) already used, so nothing downstream moves.
 *
 * The trade rows keep the bond branch exactly as it shipped, including its
 * `/ rate` conversion: no `type: 'bond'` symbol is configured, so the branch
 * is dormant, and a move must not change behaviour. `dashboard.test.ts`
 * drives the valuation view-models, which is the gate for this slice.
 */

type PortfolioValuation = components['schemas']['PortfolioValuation'];
type OhlcCandle = components['schemas']['OhlcCandle'];
type HistoryPoint = components['schemas']['HistoryPoint'];

/** The trade shape the history rows read — a structural subset of the store's `DashboardTrade`. */
export interface DisplayTrade {
  id?: string;
  symbol: string;
  side: string;
  qty: number;
  price?: number | null;
  profit?: number;
  time: string;
}

/** Everything the view-models derive from. All getters, so a computed never holds a setup-time snapshot. */
export interface DisplayComputedsDeps {
  /** The server's valuation payload — the single input of the five valuation view-models. */
  readonly valuation: () => PortfolioValuation | null;
  /** Spot price map as the server sent it; a missing symbol reads as `0`. */
  readonly prices: () => Record<string, number>;
  /** The store's price-load error, when the last load failed. */
  readonly priceError: () => string | null;
  /** Trades in time order, as the store holds them. */
  readonly trades: () => DisplayTrade[];
  /** Classifier deciding a symbol's display currency (`isBRLNonBond` etc.). */
  readonly classifier: () => SymbolClassifier;
  /** BRLUSD — one BRL in USD (~0.196). `0` means unknown, not parity. */
  readonly brlUsdRate: () => number;
  /** Which chart series is selected; picks the candle source. */
  readonly activeMetric: () => 'value' | 'pnl';
  /** Portfolio-value OHLC candles. */
  readonly historyOHLC: () => OhlcCandle[];
  /** Profit/loss OHLC candles. */
  readonly pnlOHLC: () => OhlcCandle[];
  /** Whether the trend projection is switched on. */
  readonly projectionEnabled: () => boolean;
  /** Portfolio-value history points. */
  readonly history: () => HistoryPoint[];
}

/** The allocation chart's slice colours, cycled by index; re-exported by the store. */
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

/** A row's own-currency display string, without `formatMoney`'s thousands spacing — the tables have always rendered this way. */
function legacyAmount(amount: number, currency: Currency): string {
  return `${currency === 'BRL' ? 'R$' : '$'}${Math.abs(amount).toFixed(2)}`;
}

function legacySigned(amount: number, currency: Currency): string {
  return `${amount < 0 ? '-' : '+'}${legacyAmount(amount, currency)}`;
}

export function useDisplayComputeds(deps: DisplayComputedsDeps) {
  const priceOf = (s: string): number => deps.prices()[s] ?? 0;

  const metrics = computed(() => {
    const v = deps.valuation();
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

  const zeroPriceAssets = computed(() => {
    const prices = deps.prices();
    return Object.keys(prices).filter((k) => prices[k] == null || prices[k] === 0);
  });
  const hasPriceError = computed(() => deps.priceError() !== null || zeroPriceAssets.value.length > 0);

  const positionRows = computed(() =>
    (deps.valuation()?.rows ?? [])
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
    (deps.valuation()?.rows ?? [])
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
    const slices = deps.valuation()?.allocation ?? [];
    return {
      labels: slices.map((slice) => slice.label),
      values: slices.map((slice) => slice.value),
      pcts: slices.map((slice) => slice.pct),
      colors: slices.map((_, i) => ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length]),
    };
  });

  const plByAsset = computed(() => {
    const rows = deps.valuation()?.plByAsset ?? [];
    return {
      labels: rows.map((row) => row.symbol),
      values: rows.map((row) => row.pl),
      colors: rows.map((row) => (row.pl >= 0 ? '#10b981' : '#ef4444')),
    };
  });

  const projection = computed(() => (deps.projectionEnabled() ? computeProjection(deps.history()) : []));

  const tradeRows = computed(() => {
    const rate = deps.brlUsdRate() || 1;
    const classifier = deps.classifier();
    const isBRLNonBond = (s: string): boolean => classifier.isBRLNonBond(s);
    const isBRLBond = (s: string): boolean => classifier.isBRLBond(s);
    return deps.trades().map((t) => {
      const symbol = t.symbol;
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
    const source = deps.activeMetric() === 'pnl' ? deps.pnlOHLC() : deps.historyOHLC();
    return source.map((c) => ({
      time: Math.floor((c.ts ?? 0) / 1000),
      open: c.open ?? 0,
      high: c.high ?? 0,
      low: c.low ?? 0,
      close: c.close ?? 0,
    }));
  });

  return {
    metrics,
    zeroPriceAssets,
    hasPriceError,
    positionRows,
    cashPositionRows,
    allocation,
    plByAsset,
    projection,
    tradeRows,
    valueCandles,
  };
}
