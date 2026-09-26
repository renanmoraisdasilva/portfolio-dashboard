'use strict';

const {
  buildCashAssetSeries,
  buildCashCurrencySeries,
  computeCorrelatedAxisMax,
  computePnlReturns,
  stdDev,
  computeRiskProfile,
} = require('../lib/analytics-insights');

describe('buildCashAssetSeries', () => {
  test('builds cash and assets using cumulative cash entries and FX', () => {
    const history = [
      { ts: 1, v: 1000, brlusd_rate: 0.2 },
      { ts: 2, v: 1200, brlusd_rate: 0.25 },
    ];
    const cashEntries = [
      { ts: 1, currency: 'USD', amount: 100 },
      { ts: 2, currency: 'BRL', amount: 200 },
    ];

    const out = buildCashAssetSeries(history, cashEntries, 0.2);
    expect(out).toHaveLength(2);

    // ts=1: cash=100 USD
    expect(out[0].cashUSD).toBeCloseTo(100);
    expect(out[0].assetsUSD).toBeCloseTo(900);

    // ts=2: cash=100 + 200*0.25 = 150
    expect(out[1].cashUSD).toBeCloseTo(150);
    expect(out[1].assetsUSD).toBeCloseTo(1050);
  });

  test('treats generated rows like any other ledger delta', () => {
    const history = [
      { ts: 1, v: 1000, brlusd_rate: 0.2 },
      { ts: 2, v: 1100, brlusd_rate: 0.2 },
    ];
    const cashEntries = [
      { ts: 1, currency: 'USD', amount: 800, description: 'Cash backfill estimate' },
      { ts: 2, currency: 'USD', amount: -600, description: 'Cash backfill estimate' },
      { ts: 2, currency: 'USD', amount: 200, description: 'deposit' },
    ];

    const out = buildCashAssetSeries(history, cashEntries, 0.2);
    expect(out).toHaveLength(2);

    // ts=1: 800
    expect(out[0].cashUSD).toBeCloseTo(800);
    expect(out[0].assetsUSD).toBeCloseTo(200);

    // ts=2: 800 - 600 + 200 = 400
    expect(out[1].cashUSD).toBeCloseTo(400);
    expect(out[1].assetsUSD).toBeCloseTo(700);
  });

  test('is description-agnostic for equivalent cash deltas', () => {
    const history = [
      { ts: 1, v: 1000, brlusd_rate: 0.2 },
      { ts: 2, v: 1200, brlusd_rate: 0.2 },
    ];

    const withGeneratedDescriptions = [
      { ts: 1, currency: 'USD', amount: 300, description: 'Cash backfill estimate' },
      { ts: 2, currency: 'USD', amount: -50, description: 'Cash backfill estimate' },
    ];
    const withManualDescriptions = [
      { ts: 1, currency: 'USD', amount: 300, description: 'deposit' },
      { ts: 2, currency: 'USD', amount: -50, description: 'withdrawal' },
    ];

    const generatedOut = buildCashAssetSeries(history, withGeneratedDescriptions, 0.2);
    const manualOut = buildCashAssetSeries(history, withManualDescriptions, 0.2);

    expect(generatedOut).toEqual(manualOut);
  });

  test('includes entries at exact timestamp and excludes future ones', () => {
    const history = [
      { ts: 10, v: 1000, brlusd_rate: 0.2 },
      { ts: 20, v: 1000, brlusd_rate: 0.2 },
      { ts: 30, v: 1000, brlusd_rate: 0.2 },
    ];
    const cashEntries = [
      { ts: 10, currency: 'USD', amount: 100 },
      { ts: 20, currency: 'USD', amount: 50 },
      { ts: 31, currency: 'USD', amount: 900 },
    ];

    const out = buildCashAssetSeries(history, cashEntries, 0.2);
    expect(out[0].cashUSD).toBeCloseTo(100);
    expect(out[1].cashUSD).toBeCloseTo(150);
    expect(out[2].cashUSD).toBeCloseTo(150);
  });

  test('sorts history and cash entries before computing series', () => {
    const historyUnsorted = [
      { ts: 2, v: 1100, brlusd_rate: 0.2 },
      { ts: 1, v: 1000, brlusd_rate: 0.2 },
    ];
    const cashUnsorted = [
      { ts: 2, currency: 'USD', amount: 20 },
      { ts: 1, currency: 'USD', amount: 80 },
    ];

    const out = buildCashAssetSeries(historyUnsorted, cashUnsorted, 0.2);

    expect(out).toHaveLength(2);
    expect(out[0].ts).toBe(1);
    expect(out[0].cashUSD).toBeCloseTo(80);
    expect(out[1].ts).toBe(2);
    expect(out[1].cashUSD).toBeCloseTo(100);
  });

  test('never returns negative assets even when cash exceeds total', () => {
    const history = [{ ts: 1, v: 100, brlusd_rate: 0.2 }];
    const cashEntries = [{ ts: 1, currency: 'USD', amount: 180 }];

    const out = buildCashAssetSeries(history, cashEntries, 0.2);
    expect(out[0].cashUSD).toBeCloseTo(180);
    expect(out[0].assetsUSD).toBe(0);
    expect(out[0].totalUSD).toBeCloseTo(100);
  });
});

describe('buildCashCurrencySeries', () => {
  test('reconstructs BRL and USD native running balances by timestamp', () => {
    const history = [
      { ts: 10 },
      { ts: 20 },
      { ts: 30 },
    ];
    const cashEntries = [
      { ts: 20, currency: 'USD', amount: 50 },
      { ts: 10, currency: 'BRL', amount: 1000 },
      { ts: 20, currency: 'BRL', amount: -200 },
      { ts: 31, currency: 'USD', amount: 999 },
    ];

    const out = buildCashCurrencySeries(history, cashEntries);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ ts: 10, cashBRL: 1000, cashUSDNative: 0 });
    expect(out[1]).toEqual({ ts: 20, cashBRL: 800, cashUSDNative: 50 });
    expect(out[2]).toEqual({ ts: 30, cashBRL: 800, cashUSDNative: 50 });
  });
});

describe('computeCorrelatedAxisMax', () => {
  test('locks dual-axis maxima by the provided FX ratio', () => {
    const out = computeCorrelatedAxisMax([100000], [18000], 0.2, 1.08);
    expect(out.fx).toBeCloseTo(0.2);
    expect(out.yBRLMax).toBeCloseTo(108000);
    expect(out.yUSDMax).toBeCloseTo(21600);
    expect(out.ratio).toBeCloseTo(0.2);
  });

  test('falls back to fx=1 when invalid fx is provided', () => {
    const out = computeCorrelatedAxisMax([100], [50], 0);
    expect(out.fx).toBe(1);
    expect(out.ratio).toBeCloseTo(1);
    expect(out.yBRLMax).toBeGreaterThan(0);
    expect(out.yUSDMax).toBeGreaterThan(0);
  });
});

describe('computePnlReturns', () => {
  test('computes P/L returns from delta(P/L)/previous invested', () => {
    const history = [
      { ts: 1, i: 10000, p: 100 },
      { ts: 2, i: 10000, p: 200 },
      { ts: 3, i: 10000, p: 50 },
    ];

    const returns = computePnlReturns(history);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.01);
    expect(returns[1]).toBeCloseTo(-0.015);
  });
});

describe('stdDev', () => {
  test('returns 0 for empty', () => {
    expect(stdDev([])).toBe(0);
  });

  test('computes population standard deviation', () => {
    expect(stdDev([1, 1, 1])).toBeCloseTo(0);
    expect(stdDev([0, 2])).toBeCloseTo(1);
  });
});

describe('computeRiskProfile', () => {
  test('returns low risk for benign inputs', () => {
    const p = computeRiskProfile({
      drawdownPct: 2,
      sharpeRatio: 1.8,
      cashPct: 10,
      deployableCashPct: 2,
      emergencyCoverage: 1.2,
      maxAssetAllocPct: 25,
      periodReturnPct: 3,
      pnlStdPct: 0.2,
    });
    expect(p.score).toBeLessThan(35);
    expect(p.label).toBe('Low');
  });

  test('returns high or very high risk for stressed inputs', () => {
    const p = computeRiskProfile({
      drawdownPct: 25,
      sharpeRatio: -1.2,
      cashPct: 50,
      deployableCashPct: 45,
      emergencyCoverage: 0.4,
      maxAssetAllocPct: 70,
      periodReturnPct: 8,
      pnlStdPct: 4,
    });
    expect(p.score).toBeGreaterThanOrEqual(55);
    expect(['High', 'Very High']).toContain(p.label);
  });

  test('emergency coverage reduces risk score', () => {
    const weakCoverage = computeRiskProfile({
      drawdownPct: 8,
      sharpeRatio: 0.4,
      cashPct: 70,
      deployableCashPct: 45,
      emergencyCoverage: 0.6,
      maxAssetAllocPct: 35,
      periodReturnPct: 2,
      pnlStdPct: 1,
    });
    const fullCoverage = computeRiskProfile({
      drawdownPct: 8,
      sharpeRatio: 0.4,
      cashPct: 70,
      deployableCashPct: 20,
      emergencyCoverage: 1.4,
      maxAssetAllocPct: 35,
      periodReturnPct: 2,
      pnlStdPct: 1,
    });

    expect(fullCoverage.score).toBeLessThan(weakCoverage.score);
    expect(fullCoverage.components.cashBufferCredit).toBeGreaterThan(0);
  });
});
