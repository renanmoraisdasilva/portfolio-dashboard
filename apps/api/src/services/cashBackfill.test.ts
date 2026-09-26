/**
 * Unit tests for cashBackfill.ts — pure functions, no DB, no mocks.
 *
 * Covers:
 *   sampleEvenly        — edge cases and even distribution
 *   computeCashEstimates — USD asset cash derivation, BRL-denominated assets,
 *                          snapshot skipped when no prices, brlusd fallbacks,
 *                          trades filtered to timestamp cutoff
 *   estimatesToDeltas   — first-entry as full deposit, incremental deltas,
 *                          tiny delta omission threshold
 */

import { sampleEvenly, computeCashEstimates, estimatesToDeltas, PriceMap } from './cashBackfill';

// ─── sampleEvenly ─────────────────────────────────────────────────────────────

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

// ─── computeCashEstimates ─────────────────────────────────────────────────────

// Base timestamp used across tests
const T0 = 1_700_000_000_000; // ~Nov 2023
const t = (offsetMs: number) => T0 + offsetMs;
const iso = (offsetMs: number) => new Date(t(offsetMs)).toISOString();

describe('computeCashEstimates – basic USD portfolio', () => {
  test('cash = snapshot.v minus investment value', () => {
    // 1 BTC bought at 40 000, currently priced at 45 000
    // snapshot total = 50 000 → cash = 5 000 USD → cashBRL = 5000/0.2 = 25 000
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
    // Investment worth 60 000, snapshot says 55 000 — stale snapshot
    const snapshots = [{ ts: t(3600_000), v: 55_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    const prices = { BTC: 60_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    expect(estimates[0].cashBRL).toBeCloseTo(-25_000, 2); // -5000 / 0.2
  });

  test('multiple snapshots produce independent estimates', () => {
    const snapshots = [
      { ts: t(3600_000), v: 50_000, brlusd_rate: 0.2 },
      { ts: t(7200_000), v: 60_000, brlusd_rate: 0.2 },
    ];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(0) }];
    // Different prices at different timestamps
    const priceMap: Record<number, Record<string, number>> = {
      [t(3600_000)]: { BTC: 45_000, BRLUSD: 0.2 },
      [t(7200_000)]: { BTC: 50_000, BRLUSD: 0.2 },
    };

    const estimates = computeCashEstimates(snapshots, trades, (ts) => priceMap[ts] ?? {});

    expect(estimates).toHaveLength(2);
    // T0+1h: cash = 50000 - 45000 = 5000 USD → 25000 BRL
    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
    // T0+2h: cash = 60000 - 50000 = 10000 USD → 50000 BRL
    expect(estimates[1].cashBRL).toBeCloseTo(50_000, 2);
  });
});

describe('computeCashEstimates – trade filtering', () => {
  test('trades after snapshot timestamp are excluded', () => {
    // Buy BTC *after* snapshot — snapshot should show pure cash
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: iso(2000) }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // No investment at ts, so cash = 50000 USD → 250000 BRL
    expect(estimates[0].cashBRL).toBeCloseTo(250_000, 2);
  });

  test('trades exactly at snapshot cutoff are included', () => {
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    // time === cutoff ISO string — should be included
    const trades = [{ symbol: 'BTC', side: 'buy', qty: 1, price: 40_000, time: new Date(t(1000)).toISOString() }];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // Investment = 45000, cash = 5000 USD → 25000 BRL
    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
  });

  test('FIFO sell reduces open lots before price calculation', () => {
    // Buy 2 BTC, sell 1 BTC → 1 BTC open
    const snapshots = [{ ts: t(3000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [
      { symbol: 'BTC', side: 'buy',  qty: 2, price: 40_000, time: iso(0) },
      { symbol: 'BTC', side: 'sell', qty: 1, price: 50_000, time: iso(1000) },
    ];
    const prices = { BTC: 45_000, BRLUSD: 0.2 };

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // 1 BTC @ 45000 = investment 45000, cash = 50000 - 45000 = 5000 USD → 25000 BRL
    expect(estimates[0].cashBRL).toBeCloseTo(25_000, 2);
  });
});

describe('computeCashEstimates – BRL-denominated assets (isBRLNonBond)', () => {
  test('IVVB11 price is converted USD via brlusd before subtraction', () => {
    // 100 IVVB11 @ BRL price 400, brlusd=0.2 → priceUSD = 400*0.2 = 80 → investment = 8000 USD
    // snapshot.v = 10000, cash = 2000 USD → cashBRL = 2000/0.2 = 10000
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
    // Only first ts has prices
    const estimates = computeCashEstimates(
      snapshots,
      trades,
      (ts): PriceMap => ts === t(1000) ? { BRLUSD: 0.2 } : {},
    );

    expect(estimates).toHaveLength(1);
    expect(estimates[0].ts).toBe(t(1000));
  });

  test('uses brlusd_rate from snapshot when BRLUSD not in prices', () => {
    // snapshot.brlusd_rate = 0.18, prices has no BRLUSD key
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.18 }];
    const trades: any[] = [];
    const prices = { BTC: 45_000 }; // no BRLUSD

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // cash = 50000 USD → cashBRL = 50000 / 0.18
    expect(estimates[0].cashBRL).toBeCloseTo(50_000 / 0.18, 1);
  });

  test('falls back to brlusd=1 when neither snapshot rate nor BRLUSD price exists', () => {
    const snapshots = [{ ts: t(1000), v: 10_000, brlusd_rate: null }];
    const trades: any[] = [];
    const prices = { BTC: 45_000 }; // no BRLUSD

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // brlusd defaults to 1 → cashBRL = cashUSD = 10000
    expect(estimates[0].cashBRL).toBeCloseTo(10_000, 2);
  });

  test('symbols missing from prices are skipped in investment calc', () => {
    // Buy ETH but no ETH price available → treated as 0 investment
    const snapshots = [{ ts: t(1000), v: 50_000, brlusd_rate: 0.2 }];
    const trades = [{ symbol: 'ETH', side: 'buy', qty: 5, price: 2000, time: iso(0) }];
    const prices = { BRLUSD: 0.2 }; // ETH missing

    const estimates = computeCashEstimates(snapshots, trades, () => prices);

    // investmentUSD = 0 (ETH skipped), cash = 50000 → cashBRL = 250000
    expect(estimates[0].cashBRL).toBeCloseTo(250_000, 2);
  });
});

// ─── estimatesToDeltas ────────────────────────────────────────────────────────

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
      { ts: t(0),    cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 15_000 },
    ]);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].amount).toBeCloseTo(10_000, 4);  // initial deposit
    expect(deltas[1].amount).toBeCloseTo( 5_000, 4);  // +5000 increase
  });

  test('SUM of all deltas reconstructs final cashBRL', () => {
    const estimates = [
      { ts: t(0),    cashBRL: 10_000 },
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
      { ts: t(0),    cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 25_000 },
      { ts: t(2000), cashBRL: 20_000 },
    ];
    const deltas = estimatesToDeltas(estimates);

    // Sum up to t(1000) should equal 25000
    const sumAtT1 = deltas.filter(d => d.ts <= t(1000)).reduce((s, d) => s + d.amount, 0);
    expect(sumAtT1).toBeCloseTo(25_000, 4);
  });

  test('omits entries where |delta| < 0.001', () => {
    const deltas = estimatesToDeltas([
      { ts: t(0),    cashBRL: 10_000 },
      { ts: t(1000), cashBRL: 10_000.0005 }, // tiny change, should be skipped
      { ts: t(2000), cashBRL: 20_000 },
    ]);
    expect(deltas).toHaveLength(2);
    expect(deltas[0].amount).toBeCloseTo(10_000, 2);
    // prev advances to 10000.0005 even when skipped, so jump to 20000 is 9999.9995
    expect(deltas[1].amount).toBeCloseTo(10_000, 1);
  });

  test('handles decreasing cash (withdrawal deltas are negative)', () => {
    const deltas = estimatesToDeltas([
      { ts: t(0),    cashBRL: 30_000 },
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
    expect(deltas.map(d => d.ts)).toEqual([t(100), t(200), t(300)]);
  });
});
