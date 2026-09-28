import { sampleEvenly, computeCashEstimates, estimatesToDeltas, PriceMap } from './cashBackfill';

describe('sampleEvenly', () => {
  test('returns input as-is when length <= n', () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(sampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  test('returns first element when n=1', () => {
    expect(sampleEvenly([10, 20, 30, 40], 1)).toEqual([10]);
  });

  test('always includes first and last element', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const sampled = sampleEvenly(arr, 4);
    expect(sampled[0]).toBe(1);
    expect(sampled[sampled.length - 1]).toBe(10);
    expect(sampled).toHaveLength(4);
  });

  test('returns exactly n elements', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    expect(sampleEvenly(arr, 30)).toHaveLength(30);
  });

  test('single element array', () => {
    expect(sampleEvenly([42], 10)).toEqual([42]);
  });
});

const T0 = 1_700_000_000_000;
const t = (offsetMs: number) => T0 + offsetMs;
const iso = (offsetMs: number) => new Date(t(offsetMs)).toISOString();

describe('computeCashEstimates – basic USD portfolio', () => {
  test('cash = snapshot.v minus investment value', () => {
    const snapshots = [{ ts: t(3600_000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates).toHaveLength(1);
    expect(estimates[0].ts).toBe(t(3600_000));
    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
  });

  test('cash is zero when all value is in investments', () => {
    const snapshots = [{ ts: t(3600_000), v: 45_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(0, 4);
  });

  test('cash can be negative (price rose above snapshot value)', () => {
    const snapshots = [{ ts: t(3600_000), v: 55_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const prices = { BTC: 60_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(-25_000, 2);
  });

  test('multiple snapshots produce independent estimates', () => {
    const snapshots = [
      { ts: t(3600_000), v: 50_000, brlusd_rate: 0.2 },
      { ts: t(7200_000), v: 60_000, brlusd_rate: 0.2 },
    ];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const priceMap: Record<number, Record<string, number>> = {
      [t(3600_000)]: { BTC: 45_000, BRLUSD: 0.2 },
      [t(7200_000)]: { BTC: 50_000, BRLUSD: 0.2 },
    };

    const estimates = computeCashEstimates(snapshots, trades, (ts) => priceMap[ts] ?? {});

    expect(estimates).toHaveLength(2);
    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
    expect(estimates[1].cashBRL).toBeCloseTo(50_000, 2);
  });

  test('a fully sold position contributes no investment', () => {
    const snapshots = [{ ts: t(3600_000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 45_000, time: iso(1000) },
    ];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(250_000, 2);
  });

  test('a zero BRLUSD rate yields 0 BRL instead of Infinity', () => {
    const snapshots = [{ ts: t(3600_000), v: 50_000, brlusd_rate: 0 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBe(0);
  });
});

describe('computeCashEstimates – trade filtering', () => {
  test('trades after snapshot timestamp are excluded', () => {
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(2000) }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(250_000, 2);
  });

  test('trades exactly at snapshot cutoff are included', () => {
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: new Date(t(1000)).toISOString() }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
  });

  test('FIFO sell reduces open lots before price calculation', () => {
    const snapshots = [{ ts: t(3000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [
      { symbol: 'BTC', side: 'buy', qty: 2, price: 40_000, time: iso(0) },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 50_000, time: iso(1000) },
    ];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
  });
});

describe('computeCashEstimates – BRL-denominated assets (isBRLNonBond)', () => {
  test('IVVB11 price is converted USD via brlusd before subtraction', () => {
    const snapshots = [{ ts: t(3600_000), v: 10_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'IVVB11', side: 'buy', qty: 100, price: 350, time: iso(0) }];
    const prices = { IVVB11: 400, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates).toHaveLength(1);
    expect(estimates[0].cashBRL).toBeCloseTo(10_000, 2);
  });
});

describe('computeCashEstimates – price lookup edge cases', () => {
  test('skips snapshot when getPricesAt returns empty object', () => {
    const snapshots = [
      { ts: t(1000), v: 50_000, brlusd_rate: 0.2 },
      { ts: t(2000), v: 60_000, brlusd_rate: 0.2 },
    ];
    const trades: any[] = [];
    const estimates = computeCashEstimates(snapshots, trades, (ts): PriceMap => (ts === t(1000) ? { BRLUSD: 0.2 } : {}));

    expect(estimates).toHaveLength(1);
    expect(estimates[0].ts).toBe(t(1000));
  });

  test('uses brlusd_rate from snapshot when BRLUSD not in prices', () => {
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.18 }];
    const trades: any[] = [];
    const prices = { BTC: 45_000 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(50_000 / 0.18, 1);
  });

  test('falls back to brlusd=1 when neither snapshot rate nor BRLUSD price exists', () => {
    const snapshots = [{ ts: t(1000), v: 10_000, brlusd_rate: null }];
    const trades: any[] = [];
    const prices = { BTC: 45_000 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(10_000, 2);
  });

  test('symbols missing from prices are skipped in investment calc', () => {
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'ETH', side: 'buy', qty: 5, price: 2000, time: iso(0) }];
    const prices = { BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(250_000, 2);
  });
});

describe('estimatesToDeltas', () => {
  test('empty input returns empty array', () => {
    expect(estimatesToDeltas([])).toEqual([]);
  });

  test('single estimate produces one delta equal to cashBRL', () => {
    const deltas = estimatesToDeltas([{ ts: t(0), cashBRL: 25_000 }]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toEqual({ ts: t(0), amount: 25_000 });
  });

  test('two estimates produce correct initial + incremental deltas', () => {
    const deltas = estimatesToDeltas([
      { ts: t(0), cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 15_000 },
    ]);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].amount).toBeCloseTo(10_000, 4);
    expect(deltas[1].amount).toBeCloseTo(5_000, 4);
  });

  test('SUM of all deltas reconstructs final cashBRL', () => {
    const estimates = [
      { ts: t(0), cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 25_000 },
      { ts: t(2000), cashBRL: 20_000 },
      { ts: t(3000), cashBRL: 30_000 },
    ];
    const deltas = estimatesToDeltas(estimates);
    const total = deltas.reduce((s, d) => s + d.amount, 0);
    expect(total).toBeCloseTo(30_000, 4);
  });

  test('SUM up to ts T reconstructs cashBRL at T', () => {
    const estimates = [
      { ts: t(0), cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 25_000 },
      { ts: t(2000), cashBRL: 20_000 },
    ];
    const deltas = estimatesToDeltas(estimates);

    const sumAtT1 = deltas.filter((d) => d.ts <= t(1000)).reduce((s, d) => s + d.amount, 0);
    expect(sumAtT1).toBeCloseTo(25_000, 4);
  });

  test('omits entries where |delta| < 0.001', () => {
    const deltas = estimatesToDeltas([
      { ts: t(0), cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 10_000.0005 }, // tiny change, should be skipped
      { ts: t(2000), cashBRL: 20_000 },
    ]);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].amount).toBeCloseTo(10_000, 2);
    expect(deltas[1].amount).toBeCloseTo(10_000, 1);
  });

  test('handles decreasing cash (withdrawal deltas are negative)', () => {
    const deltas = estimatesToDeltas([
      { ts: t(0), cashBRL: 30_000 },
      { ts: t(1000), cashBRL: 10_000 },
    ]);
    expect(deltas[1].amount).toBeCloseTo(-20_000, 4);
  });

  test('preserves ts for each delta', () => {
    const deltas = estimatesToDeltas([
      { ts: t(100), cashBRL: 1000 },
      { ts: t(200), cashBRL: 2000 },
      { ts: t(300), cashBRL: 1500 },
    ]);
    expect(deltas.map((d) => d.ts)).toEqual([t(100), t(200), t(300)]);
  });
});
