// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import {
  computeProjection,
  createSymbolClassifier,
  formatMoney,
  formatSigned,
  type SymbolMap,
} from '@portfolio-dashboard/shared';
import { useDisplayComputeds, type DisplayComputedsDeps, type DisplayTrade } from './useDisplayComputeds';

/**
 * Direct tests for the dashboard's view-models — the layer the store suite
 * reaches only through the assembled Pinia store. Everything here is a pure
 * computed behind eleven getters, so a test is a plain object literal: no
 * network harness, no Pinia, and the assertions describe rendered strings
 * rather than wiring.
 *
 * The composable hands back raw computed refs — Pinia unwraps them for the
 * store's consumers, so a direct call like this one reads `.value`.
 *
 * Three things this suite exists to pin:
 * - `tradeRows`' three currency branches — none of them is asserted anywhere
 *   else, and the bond branch is dormant in production (no `type: 'bond'`
 *   symbol is configured), so this is its only guard;
 * - the price-health derivations (`zeroPriceAssets`, `hasPriceError`), which
 *   the store suite only exercises as a pair;
 * - the getters contract itself: a computed reads live state, never a
 *   setup-time snapshot.
 */

type PortfolioValuation = components['schemas']['PortfolioValuation'];
type OhlcCandle = components['schemas']['OhlcCandle'];

const SYMBOLS: SymbolMap = {
  SPY: { type: 'stock' },
  BOVA11: { type: 'stock', denominatedInBRL: true },
  CDB: { type: 'bond', denominatedInBRL: true },
};

const VALUATION: PortfolioValuation = {
  total: 200,
  invested: 50,
  investedNet: 40,
  realized: 10,
  unrealized: 10,
  unrealizedPct: 25,
  tickerValue: 200,
  investedPct: 47.57,
  breakEven: false,
  rows: [],
  allocation: [],
  plByAsset: [],
  brlUsdRate: 0.25,
  salesCount: 0,
};

const RATE = 0.25;
const TIME = '2026-01-02T12:00:00.000Z';

function makeVm(overrides: Partial<DisplayComputedsDeps> = {}) {
  return useDisplayComputeds({
    valuation: () => null,
    prices: () => ({}),
    priceError: () => null,
    trades: () => [],
    classifier: () => createSymbolClassifier(SYMBOLS),
    brlUsdRate: () => RATE,
    activeMetric: () => 'value',
    historyOHLC: () => [],
    pnlOHLC: () => [],
    projectionEnabled: () => false,
    history: () => [],
    ...overrides,
  });
}

function trade(overrides: Partial<DisplayTrade> = {}): DisplayTrade {
  return { id: 't1', symbol: 'SPY', side: 'buy', qty: 1, price: 10, time: TIME, ...overrides };
}

describe('the metric and chart view-models on an absent valuation', () => {
  test('a missing valuation reads as zeroes, not as undefined', () => {
    const vm = makeVm();
    expect(vm.metrics.value.total).toBe(0);
    expect(vm.metrics.value.investedShareOfTotal).toBe(0);
    expect(vm.metrics.value.breakEven).toBe(true); // the server's default when it sends nothing
    expect(vm.allocation.value.labels).toEqual([]);
    expect(vm.allocation.value.colors).toEqual([]);
    expect(vm.plByAsset.value.values).toEqual([]);
  });

  test('investedShareOfTotal is a share of the total, not the server investedPct', () => {
    const vm = makeVm({ valuation: () => VALUATION });
    expect(vm.metrics.value.investedShareOfTotal).toBe(25); // 50 of 200
    expect(vm.metrics.value.investedPct).toBe(47.57);
  });

  test('allocation colours cycle the palette and P/L colours follow the sign', () => {
    const vm = makeVm({
      valuation: () => ({
        ...VALUATION,
        allocation: [
          { label: 'A', value: 1, pct: 60 },
          { label: 'B', value: 1, pct: 40 },
          { label: 'C', value: 1, pct: 0 },
        ],
        plByAsset: [
          { symbol: 'WIN', pl: 5 },
          { symbol: 'LOSE', pl: -5 },
        ],
      }),
    });
    expect(vm.allocation.value.colors).toEqual(['#dc2626', '#15803d', '#0891b2']);
    expect(vm.plByAsset.value.colors).toEqual(['#10b981', '#ef4444']);
  });
});

describe('price health', () => {
  test('a zero price is a load error even when nothing failed', () => {
    const vm = makeVm({ prices: () => ({ BTC: 100, BROKEN: 0 }) });
    expect(vm.zeroPriceAssets.value).toEqual(['BROKEN']);
    expect(vm.hasPriceError.value).toBe(true);
  });

  test('a failed load is an error even when no price is zero', () => {
    const vm = makeVm({ priceError: () => 'Could not load prices' });
    expect(vm.zeroPriceAssets.value).toEqual([]);
    expect(vm.hasPriceError.value).toBe(true);
  });

  test('a clean load with real prices is not an error', () => {
    const vm = makeVm({ prices: () => ({ BTC: 100 }) });
    expect(vm.hasPriceError.value).toBe(false);
  });
});

describe('trade rows', () => {
  test('a USD buy shows its price, its total and no profit', () => {
    const vm = makeVm({ trades: () => [trade({ qty: 2, price: 125.5 })] });
    const t = vm.tradeRows.value[0];
    expect(t.price).toBe('$125.50');
    expect(t.total).toBe('$251.00');
    expect(t.profit).toEqual({ text: '-', positive: null });
    expect(t.side).toBe('BUY');
    expect(t.isBuy).toBe(true);
    expect(t.time).toBe(new Date(TIME).toLocaleString());
  });

  test('a USD sell books its profit without a plus prefix', () => {
    const vm = makeVm({ trades: () => [trade({ side: 'sell', profit: 12.5 })] });
    const t = vm.tradeRows.value[0];
    expect(t.isBuy).toBe(false);
    expect(t.profit).toEqual({ text: '$12.50', positive: true });
  });

  test('a BRL non-bond trade formats price, total and profit in reais', () => {
    const vm = makeVm({
      trades: () => [trade({ symbol: 'BOVA11', qty: 10, price: 169.27, side: 'sell', profit: -30 })],
    });
    const t = vm.tradeRows.value[0];
    expect(t.price).toBe(formatMoney(169.27, 'BRL'));
    expect(t.total).toBe(formatMoney(1_692.7, 'BRL'));
    expect(t.profit).toEqual({ text: formatSigned(-30, 'BRL'), positive: false });
  });

  test('a trade with no stored price falls back to the live price for its total', () => {
    const vm = makeVm({ trades: () => [trade({ price: null })], prices: () => ({ SPY: 500 }) });
    const t = vm.tradeRows.value[0];
    expect(t.price).toBe('-');
    expect(t.total).toBe('$500.00');
  });

  test('the dormant bond branch converts dollars to reais at the shipped rate', () => {
    // Shipped behaviour, pinned as-is: the branch divides by the rate
    // (100 / 0.25 = 400), and no `type: 'bond'` symbol is configured, so this
    // test is the only thing that will notice the day one is. Changing the
    // arithmetic is a product decision, not a refactor.
    const vm = makeVm({ trades: () => [trade({ symbol: 'CDB', qty: 1, price: 100 })] });
    const t = vm.tradeRows.value[0];
    expect(t.price).toBe(formatMoney(400, 'BRL'));
    expect(t.total).toBe(formatMoney(400, 'BRL'));
  });

  test('a bond sell converts its profit at the same rate', () => {
    const vm = makeVm({ trades: () => [trade({ symbol: 'CDB', side: 'sell', price: 100, profit: 8 })] });
    expect(vm.tradeRows.value[0].profit).toEqual({ text: formatSigned(32, 'BRL'), positive: true });
  });

  test('an unknown bond rate reads as parity, not as a division by zero', () => {
    const vm = makeVm({ trades: () => [trade({ symbol: 'CDB', price: 100 })], brlUsdRate: () => 0 });
    expect(vm.tradeRows.value[0].price).toBe(formatMoney(100, 'BRL'));
  });
});

describe('candles and projection', () => {
  test('the candle series follows the selected metric and converts ms to s', () => {
    const valueCandles: OhlcCandle[] = [{ ts: 1_700_000_000_000, open: 10, high: 12, low: 9, close: 11 }];
    const pnlCandles: OhlcCandle[] = [{ ts: 1_700_000_000_000, open: 1, high: 2, low: 0.5, close: 1.5 }];
    const deps = { historyOHLC: () => valueCandles, pnlOHLC: () => pnlCandles };

    expect(makeVm(deps).valueCandles.value).toEqual([{ time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 }]);
    expect(makeVm({ ...deps, activeMetric: () => 'pnl' as const }).valueCandles.value[0].close).toBe(1.5);
  });

  test('a candle with missing fields renders as zeroes, not undefined', () => {
    const vm = makeVm({ historyOHLC: () => [{ ts: 2000 }] });
    expect(vm.valueCandles.value).toEqual([{ time: 2, open: 0, high: 0, low: 0, close: 0 }]);
  });

  test('the projection is off by default and equals the shared calculator when on', () => {
    const history = [
      { ts: 1_700_000_000_000, v: 100 },
      { ts: 1_700_086_400_000, v: 110 },
    ];
    expect(makeVm({ history: () => history }).projection.value).toEqual([]);
    expect(makeVm({ history: () => history, projectionEnabled: () => true }).projection.value).toEqual(
      computeProjection(history),
    );
  });
});

describe('the getters contract', () => {
  test('a computed reads live state, never a setup-time snapshot', () => {
    const trades = ref<DisplayTrade[]>([trade({ id: 'first' })]);
    const vm = makeVm({ trades: () => trades.value });
    expect(vm.tradeRows.value.map((t) => t.id)).toEqual(['first']);

    trades.value = [...trades.value, trade({ id: 'second' })];
    expect(vm.tradeRows.value.map((t) => t.id)).toEqual(['first', 'second']);
  });
});
