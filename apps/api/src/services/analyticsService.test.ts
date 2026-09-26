/**
 * Unit tests for analyticsService.ts — pure functions only, no DB, no mocks.
 *
 * Covers:
 *   medianInterval   — basic cases, edge cases
 *   computeReturnPct — empty, positive, negative, zero-start guard
 *   computeMaxDrawdown — no drawdown, simple drawdown, multiple peaks, monotone rise
 *   computeSharpeRatio — not enough points, gap-skipping, positive/negative Sharpe
 *   periodStartMs    — all five periods, custom `now`
 */

import {
  medianInterval,
  computeReturnPct,
  computePnLReturnPct,
  computeMaxDrawdown,
  computeSharpeRatio,
  computePnLSharpeRatio,
  computeTWR,
  buildFlowAdjustedPoints,
  toDailyClosePoints,
  toDailyClosePnLPoints,
  toDailyClosePnLInputs,
  buildPnLReturnIndexPoints,
  periodStartMs,
  type SnapshotPoint,
  type SnapshotPnLPoint,
  type CashFlowEvent,
} from './analyticsService';

const DAY_MS  = 86_400_000;
const HOUR_MS =  3_600_000;
const MIN_MS  =     60_000;

// ─── medianInterval ───────────────────────────────────────────────────────────

describe('medianInterval', () => {
  test('returns 0 for empty array', () => {
    expect(medianInterval([])).toBe(0);
  });

  test('returns 0 for single element', () => {
    expect(medianInterval([1000])).toBe(0);
  });

  test('returns the single diff for two elements', () => {
    expect(medianInterval([0, 30 * MIN_MS])).toBe(30 * MIN_MS);
  });

  test('returns median for odd number of diffs', () => {
    // diffs: 10, 20, 30 → sorted → median = 20
    const ts = [0, 10, 30, 60];
    expect(medianInterval(ts)).toBe(20);
  });

  test('returns average of two middle values for even number of diffs', () => {
    // diffs: 10, 20, 30, 40 → sorted → (20+30)/2 = 25
    const ts = [0, 10, 30, 60, 100];
    expect(medianInterval(ts)).toBe(25);
  });

  test('handles uniformly-spaced snapshots (30-min intervals)', () => {
    const base = 1_700_000_000_000;
    const ts = [0, 1, 2, 3, 4].map(i => base + i * 30 * MIN_MS);
    expect(medianInterval(ts)).toBe(30 * MIN_MS);
  });

  test('is robust to a single large gap (outlier does not dominate)', () => {
    // Most intervals: 30 min; one huge gap: 12 h
    const base = 1_700_000_000_000;
    const ts = [
      base,
      base + 30 * MIN_MS,
      base + 60 * MIN_MS,
      base + 12 * HOUR_MS,  // big gap
      base + 12 * HOUR_MS + 30 * MIN_MS,
    ];
    // diffs sorted: 30min, 30min, 30min, 11h30min → median = 30 min (middle of 4 values = avg(30min,30min))
    expect(medianInterval(ts)).toBe(30 * MIN_MS);
  });
});

// ─── computeReturnPct ─────────────────────────────────────────────────────────

describe('computeReturnPct', () => {
  test('returns null for empty array', () => {
    expect(computeReturnPct([])).toBeNull();
  });

  test('returns null for single point', () => {
    expect(computeReturnPct([{ ts: 0, v: 1000 }])).toBeNull();
  });

  test('returns null when start value is 0', () => {
    expect(computeReturnPct([{ ts: 0, v: 0 }, { ts: 1, v: 100 }])).toBeNull();
  });

  test('returns 0 when start equals end', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 1000 }, { ts: 1, v: 1000 }];
    expect(computeReturnPct(pts)).toBeCloseTo(0);
  });

  test('calculates positive return correctly', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 10000 }, { ts: 1, v: 11000 }];
    expect(computeReturnPct(pts)).toBeCloseTo(10);
  });

  test('calculates negative return correctly', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 10000 }, { ts: 1, v: 9000 }];
    expect(computeReturnPct(pts)).toBeCloseTo(-10);
  });

  test('uses only the first and last point, ignoring intermediates', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 5000 },   // intermediate dip
      { ts: 2, v: 12000 },
    ];
    expect(computeReturnPct(pts)).toBeCloseTo(20);
  });

  test('handles large gain (100% return)', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 5000 }, { ts: 1, v: 10000 }];
    expect(computeReturnPct(pts)).toBeCloseTo(100);
  });
});

// ─── computePnLReturnPct ────────────────────────────────────────────────────

describe('computePnLReturnPct', () => {
  test('returns null for fewer than 2 points', () => {
    expect(computePnLReturnPct([])).toBeNull();
    expect(computePnLReturnPct([{ ts: 0, i: 10000, p: 100 }])).toBeNull();
  });

  test('returns null when start invested is non-positive', () => {
    expect(computePnLReturnPct([
      { ts: 0, i: 0, p: 100 },
      { ts: 1, i: 1000, p: 200 },
    ])).toBeNull();
  });

  test('computes return from P/L delta over start invested', () => {
    const pts = [
      { ts: 0, i: 10000, p: 500 },
      { ts: 1, i: 12000, p: 700 },
    ];
    // (700 - 500) / 10000 = 2%
    expect(computePnLReturnPct(pts)).toBeCloseTo(2);
  });

  test('can be near zero when invested grows but P/L is flat', () => {
    const pts = [
      { ts: 0, i: 65000, p: 950 },
      { ts: 1, i: 78000, p: 900 },
    ];
    expect(computePnLReturnPct(pts)).toBeCloseTo(-0.076923, 4);
  });

  test('adds period interest gains to the return numerator', () => {
    const pts = [
      { ts: 0, i: 10000, p: 500 },
      { ts: 1, i: 12000, p: 700 },
    ];
    // (700 - 500 + 50) / 10000 = 2.5%
    expect(computePnLReturnPct(pts, 50)).toBeCloseTo(2.5);
  });

  test('interest can offset a small P/L decline', () => {
    const pts = [
      { ts: 0, i: 20000, p: 1000 },
      { ts: 1, i: 22000, p: 900 },
    ];
    // (-100 + 120) / 20000 = 0.1%
    expect(computePnLReturnPct(pts, 120)).toBeCloseTo(0.1);
  });
});

// ─── computeMaxDrawdown ───────────────────────────────────────────────────────

describe('computeMaxDrawdown', () => {
  test('returns null for empty array', () => {
    expect(computeMaxDrawdown([])).toBeNull();
  });

  test('returns null for single point', () => {
    expect(computeMaxDrawdown([{ ts: 0, v: 1000 }])).toBeNull();
  });

  test('returns null when values are monotonically increasing (no drawdown)', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 1000 }, { ts: 1, v: 1100 }, { ts: 2, v: 1200 },
    ];
    expect(computeMaxDrawdown(pts)).toBeNull();
  });

  test('detects a simple peak-to-trough drawdown', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 12000 }, // peak
      { ts: 2, v: 9000  }, // trough: (12000-9000)/12000 = 25%
    ];
    const dd = computeMaxDrawdown(pts);
    expect(dd).not.toBeNull();
    expect(dd!.pct).toBeCloseTo(25);
    expect(dd!.startTs).toBe(1);
    expect(dd!.endTs).toBe(2);
  });

  test('finds the MAXIMUM drawdown across multiple drawdown periods', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 8000  }, // dd from 0: 20%
      { ts: 2, v: 12000 }, // new peak
      { ts: 3, v: 6000  }, // dd from 2: 50% ← max
    ];
    const dd = computeMaxDrawdown(pts);
    expect(dd!.pct).toBeCloseTo(50);
    expect(dd!.startTs).toBe(2);
    expect(dd!.endTs).toBe(3);
  });

  test('peak timestamp updates correctly as new highs are reached', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 8000  },
      { ts: 1, v: 10000 }, // new peak at ts=1
      { ts: 2, v: 7000  }, // drawdown from ts=1 peak: (10000-7000)/10000 = 30%
    ];
    const dd = computeMaxDrawdown(pts);
    expect(dd!.pct).toBeCloseTo(30);
    expect(dd!.startTs).toBe(1);
    expect(dd!.endTs).toBe(2);
  });

  test('monotonically decreasing series: drawdown from first to last', () => {
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v:  8000 },
      { ts: 2, v:  5000 }, // (10000-5000)/10000 = 50%
    ];
    const dd = computeMaxDrawdown(pts);
    expect(dd!.pct).toBeCloseTo(50);
    expect(dd!.startTs).toBe(0);
    expect(dd!.endTs).toBe(2);
  });

  test('returns 0-drawdown as null (equal start and end)', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 1000 }, { ts: 1, v: 1000 }];
    expect(computeMaxDrawdown(pts)).toBeNull();
  });
});

// ─── computeSharpeRatio ───────────────────────────────────────────────────────

/** Build N evenly-spaced snapshot points starting from ts=0 with given interval. */
function makePoints(n: number, intervalMs: number, baseValue = 10000, dailyDrift = 0.001): SnapshotPoint[] {
  const pts: SnapshotPoint[] = [];
  let v = baseValue;
  for (let i = 0; i < n; i++) {
    v *= 1 + dailyDrift + (Math.random() - 0.5) * 0.002; // small noise
    pts.push({ ts: i * intervalMs, v });
  }
  return pts;
}

describe('computeSharpeRatio', () => {
  test('returns null for empty array', () => {
    expect(computeSharpeRatio([])).toBeNull();
  });

  test('returns null for single point', () => {
    expect(computeSharpeRatio([{ ts: 0, v: 1000 }])).toBeNull();
  });

  test('returns null when fewer than 30 valid observations', () => {
    const pts = makePoints(20, 30 * MIN_MS);
    expect(computeSharpeRatio(pts)).toBeNull();
  });

  test('returns a number (not null) when ≥ 30 valid observations', () => {
    const pts = makePoints(50, 30 * MIN_MS);
    const result = computeSharpeRatio(pts);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });

  test('returns null when all returns are identical (std dev = 0)', () => {
    // Constant portfolio value → no volatility → Sharpe undefined
    const pts: SnapshotPoint[] = Array.from({ length: 50 }, (_, i) => ({
      ts: i * 30 * MIN_MS,
      v: 10000,
    }));
    expect(computeSharpeRatio(pts)).toBeNull();
  });

  test('skips pairs separated by gaps exceeding 2.5× median interval', () => {
    // 29 normal 30-min intervals → normally not enough for Sharpe (< 30 returns)
    // Adding a gap pair doesn't count → still null
    const base = 1_700_000_000_000;
    const pts: SnapshotPoint[] = [
      ...Array.from({ length: 29 }, (_, i) => ({ ts: base + i * 30 * MIN_MS, v: 10000 + i * 10 })),
      // 12-hour gap — this pair is skipped
      { ts: base + 29 * 30 * MIN_MS + 12 * HOUR_MS, v: 10300 },
    ];
    // Only 29 valid pairs → null
    expect(computeSharpeRatio(pts)).toBeNull();
  });

  test('positive Sharpe for portfolio with consistent upward drift', () => {
    // High constant daily drift, low volatility → Sharpe should be positive
    const pts = makePoints(60, 30 * MIN_MS, 10000, 0.002);
    const result = computeSharpeRatio(pts, 0.045);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  test('negative Sharpe for portfolio with consistent downward drift', () => {
    const pts = makePoints(60, 30 * MIN_MS, 10000, -0.003);
    const result = computeSharpeRatio(pts, 0.045);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });

  test('accepts custom annual risk-free rate', () => {
    const pts = makePoints(60, 30 * MIN_MS, 10000, 0.001);
    const lowRF  = computeSharpeRatio(pts, 0.01);
    const highRF = computeSharpeRatio(pts, 0.10);
    // Lower risk-free rate → higher (or equal) Sharpe
    if (lowRF !== null && highRF !== null) {
      expect(lowRF).toBeGreaterThanOrEqual(highRF);
    }
  });
});

// ─── computePnLSharpeRatio ──────────────────────────────────────────────────

function makePnLPoints(
  n: number,
  intervalMs: number,
  baseInvested = 10_000,
  startPnl = 0,
  pnlDrift = 2,
): SnapshotPnLPoint[] {
  const pts: SnapshotPnLPoint[] = [];
  let p = startPnl;
  for (let i = 0; i < n; i++) {
    p += pnlDrift + (Math.random() - 0.5) * 2;
    pts.push({ ts: i * intervalMs, i: baseInvested, p });
  }
  return pts;
}

describe('computePnLSharpeRatio', () => {
  test('returns null for empty or single point', () => {
    expect(computePnLSharpeRatio([])).toBeNull();
    expect(computePnLSharpeRatio([{ ts: 0, i: 10000, p: 0 }])).toBeNull();
  });

  test('returns null for fewer than 30 valid observations', () => {
    const pts = makePnLPoints(20, 30 * MIN_MS);
    expect(computePnLSharpeRatio(pts)).toBeNull();
  });

  test('returns a number when >= 30 valid observations exist', () => {
    const pts = makePnLPoints(60, 30 * MIN_MS, 10000, 0, 3);
    const result = computePnLSharpeRatio(pts, 0.045);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('number');
  });

  test('returns null when all P/L returns are identical (std dev = 0)', () => {
    const pts: SnapshotPnLPoint[] = Array.from({ length: 50 }, (_, i) => ({
      ts: i * 30 * MIN_MS,
      i: 10000,
      p: i * 10,
    }));
    // deltaP is always 10 and i is constant => identical per-period returns
    expect(computePnLSharpeRatio(pts)).toBeNull();
  });

  test('positive Sharpe for positive P/L drift', () => {
    const pts = makePnLPoints(70, 30 * MIN_MS, 10000, 0, 4);
    const result = computePnLSharpeRatio(pts, 0.045);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });

  test('negative Sharpe for negative P/L drift', () => {
    const pts = makePnLPoints(70, 30 * MIN_MS, 10000, 0, -3);
    const result = computePnLSharpeRatio(pts, 0.045);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0);
  });
});

// ─── computeTWR ──────────────────────────────────────────────────────────────

describe('computeTWR', () => {
  test('returns null for empty array', () => {
    expect(computeTWR([])).toBeNull();
  });

  test('returns null for single point', () => {
    expect(computeTWR([{ ts: 0, v: 1000 }])).toBeNull();
  });

  test('returns null when start value is 0', () => {
    expect(computeTWR([{ ts: 0, v: 0 }, { ts: 1, v: 100 }])).toBeNull();
  });

  test('equals simple return when no cash flows are present', () => {
    const pts: SnapshotPoint[] = [{ ts: 0, v: 10000 }, { ts: 1, v: 11000 }];
    expect(computeTWR(pts, [])).toBeCloseTo(10);
  });

  test('chains sub-period returns — equals simple return without flows (telescoping)', () => {
    // Without cash flows, product(V_i/V_{i-1}) telescopes to V_last/V_first
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 5000 },   // intermediate drop
      { ts: 2, v: 12000 },
    ];
    expect(computeTWR(pts, [])).toBeCloseTo(computeReturnPct(pts)!);
  });

  test('strips out a deposit — measures only investment gain', () => {
    // Portfolio jumps from $10k to $12k solely because of a $2k deposit.
    // No investment gain → TWR should be 0%.
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 12000 }, // +$2k deposit, no market move
      { ts: 2, v: 12000 }, // unchanged
    ];
    const flows: CashFlowEvent[] = [{ ts: 1, amountUSD: 2000 }];
    expect(computeTWR(pts, flows)).toBeCloseTo(0);
  });

  test('measures investment gain correctly alongside a deposit', () => {
    // $2k deposit at ts=1, then 10% market gain on the combined $12k base.
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 12000 }, // +$2k deposit
      { ts: 2, v: 13200 }, // 10% gain on $12k
    ];
    const flows: CashFlowEvent[] = [{ ts: 1, amountUSD: 2000 }];
    // sub1: (12000-2000)/10000 = 1.0; sub2: 13200/12000 = 1.1 → TWR = 10%
    expect(computeTWR(pts, flows)).toBeCloseTo(10);
  });

  test('handles a withdrawal (negative cash flow)', () => {
    // $1k withdrawal at ts=1; then 10% investment gain on remaining $9k.
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v:  9000 }, // -$1k withdrawal
      { ts: 2, v:  9900 }, // 10% gain on $9k
    ];
    const flows: CashFlowEvent[] = [{ ts: 1, amountUSD: -1000 }];
    // sub1: (9000-(-1000))/10000 = 1.0; sub2: 9900/9000 = 1.1 → TWR = 10%
    expect(computeTWR(pts, flows)).toBeCloseTo(10);
  });

  test('cash flows before the first snapshot are ignored', () => {
    const pts: SnapshotPoint[] = [
      { ts: 100, v: 10000 },
      { ts: 200, v: 11000 },
    ];
    const flows: CashFlowEvent[] = [{ ts: 50, amountUSD: 5000 }];
    // Flow at ts=50 is before pts[0].ts=100 → ignored → simple 10% return
    expect(computeTWR(pts, flows)).toBeCloseTo(10);
  });

  test('multiple deposits across different sub-periods are each stripped correctly', () => {
    // 2 deposits: $1k at ts=1 and $1k at ts=2. No investment gain throughout.
    const pts: SnapshotPoint[] = [
      { ts: 0, v: 10000 },
      { ts: 1, v: 11000 }, // +$1k deposit only
      { ts: 2, v: 12000 }, // +$1k deposit only
      { ts: 3, v: 12000 }, // unchanged
    ];
    const flows: CashFlowEvent[] = [
      { ts: 1, amountUSD: 1000 },
      { ts: 2, amountUSD: 1000 },
    ];
    expect(computeTWR(pts, flows)).toBeCloseTo(0);
  });
});

// ─── buildFlowAdjustedPoints ────────────────────────────────────────────────

describe('buildFlowAdjustedPoints', () => {
  test('returns empty array for empty points', () => {
    expect(buildFlowAdjustedPoints([], [{ ts: 1, amountUSD: 100 }])).toEqual([]);
  });

  test('removes deposits from subsequent points', () => {
    const pts: SnapshotPoint[] = [
      { ts: 1, v: 1000 },
      { ts: 2, v: 1500 },
      { ts: 3, v: 1700 },
    ];
    const flows: CashFlowEvent[] = [{ ts: 2, amountUSD: 400 }];

    const adjusted = buildFlowAdjustedPoints(pts, flows);
    expect(adjusted).toEqual([
      { ts: 1, v: 1000 },
      { ts: 2, v: 1100 },
      { ts: 3, v: 1300 },
    ]);
  });

  test('handles deposits and withdrawals cumulatively', () => {
    const pts: SnapshotPoint[] = [
      { ts: 1, v: 1000 },
      { ts: 2, v: 1300 },
      { ts: 3, v: 1200 },
      { ts: 4, v: 1400 },
    ];
    const flows: CashFlowEvent[] = [
      { ts: 2, amountUSD: 300 },
      { ts: 4, amountUSD: -100 },
    ];

    const adjusted = buildFlowAdjustedPoints(pts, flows);
    expect(adjusted).toEqual([
      { ts: 1, v: 1000 },
      { ts: 2, v: 1000 },
      { ts: 3, v: 900 },
      { ts: 4, v: 1200 },
    ]);
  });
});

// ─── toDailyClosePoints ─────────────────────────────────────────────────────

describe('toDailyClosePoints', () => {
  test('returns empty array for empty input', () => {
    expect(toDailyClosePoints([])).toEqual([]);
  });

  test('keeps only the last point within each UTC day', () => {
    const base = Date.UTC(2026, 2, 1, 0, 0, 0, 0);
    const pts: SnapshotPoint[] = [
      { ts: base + 1 * HOUR_MS, v: 1000 },
      { ts: base + 10 * HOUR_MS, v: 1100 }, // day 1 close candidate
      { ts: base + DAY_MS + 2 * HOUR_MS, v: 900 },
      { ts: base + DAY_MS + 20 * HOUR_MS, v: 950 }, // day 2 close candidate
    ];

    expect(toDailyClosePoints(pts)).toEqual([
      { ts: base + 10 * HOUR_MS, v: 1100 },
      { ts: base + DAY_MS + 20 * HOUR_MS, v: 950 },
    ]);
  });

  test('sorts by timestamp before selecting daily closes', () => {
    const base = Date.UTC(2026, 2, 1, 0, 0, 0, 0);
    const pts: SnapshotPoint[] = [
      { ts: base + DAY_MS + 20 * HOUR_MS, v: 950 },
      { ts: base + 10 * HOUR_MS, v: 1100 },
      { ts: base + 1 * HOUR_MS, v: 1000 },
    ];

    expect(toDailyClosePoints(pts)).toEqual([
      { ts: base + 10 * HOUR_MS, v: 1100 },
      { ts: base + DAY_MS + 20 * HOUR_MS, v: 950 },
    ]);
  });
});

describe('toDailyClosePnLPoints', () => {
  test('returns empty array for empty input', () => {
    expect(toDailyClosePnLPoints([])).toEqual([]);
  });

  test('keeps last P/L point for each UTC day', () => {
    const base = Date.UTC(2026, 2, 1, 0, 0, 0, 0);
    const pts: SnapshotPnLPoint[] = [
      { ts: base + 1 * HOUR_MS, i: 10000, p: 100 },
      { ts: base + 10 * HOUR_MS, i: 10000, p: 120 },
      { ts: base + DAY_MS + 2 * HOUR_MS, i: 10000, p: 90 },
      { ts: base + DAY_MS + 20 * HOUR_MS, i: 10000, p: 80 },
    ];

    expect(toDailyClosePnLPoints(pts)).toEqual([
      { ts: base + 10 * HOUR_MS, v: 120 },
      { ts: base + DAY_MS + 20 * HOUR_MS, v: 80 },
    ]);
  });
});

describe('toDailyClosePnLInputs', () => {
  test('returns empty array for empty input', () => {
    expect(toDailyClosePnLInputs([])).toEqual([]);
  });

  test('keeps last SnapshotPnLPoint per UTC day', () => {
    const base = Date.UTC(2026, 2, 1, 0, 0, 0, 0);
    const pts: SnapshotPnLPoint[] = [
      { ts: base + 1 * HOUR_MS, i: 10000, p: 100 },
      { ts: base + 10 * HOUR_MS, i: 10020, p: 120 },
      { ts: base + DAY_MS + 2 * HOUR_MS, i: 10030, p: 90 },
      { ts: base + DAY_MS + 20 * HOUR_MS, i: 10040, p: 80 },
    ];

    expect(toDailyClosePnLInputs(pts)).toEqual([
      { ts: base + 10 * HOUR_MS, i: 10020, p: 120 },
      { ts: base + DAY_MS + 20 * HOUR_MS, i: 10040, p: 80 },
    ]);
  });
});

describe('buildPnLReturnIndexPoints', () => {
  test('returns empty array for empty input', () => {
    expect(buildPnLReturnIndexPoints([])).toEqual([]);
  });

  test('starts at 1 and chains period returns', () => {
    const pts: SnapshotPnLPoint[] = [
      { ts: 1, i: 10000, p: 100 },
      { ts: 2, i: 10000, p: 200 }, // +1%
      { ts: 3, i: 10000, p: 100 }, // -1%
    ];
    const idx = buildPnLReturnIndexPoints(pts);
    expect(idx[0]).toEqual({ ts: 1, v: 1 });
    expect(idx[1].v).toBeCloseTo(1.01);
    expect(idx[2].v).toBeCloseTo(0.9999);
  });
});

// ─── periodStartMs ────────────────────────────────────────────────────────────

describe('periodStartMs', () => {
  const now = 1_748_000_000_000; // fixed reference

  test('1W returns now - 7 days', () => {
    expect(periodStartMs('1W', now)).toBe(now - 7 * DAY_MS);
  });

  test('1M returns now - 30 days', () => {
    expect(periodStartMs('1M', now)).toBe(now - 30 * DAY_MS);
  });

  test('3M returns now - 90 days', () => {
    expect(periodStartMs('3M', now)).toBe(now - 90 * DAY_MS);
  });

  test('1Y returns now - 365 days', () => {
    expect(periodStartMs('1Y', now)).toBe(now - 365 * DAY_MS);
  });

  test('ALL returns 0 (no lower bound)', () => {
    expect(periodStartMs('ALL', now)).toBe(0);
  });

  test('unknown period falls through to 0', () => {
    expect(periodStartMs('6M', now)).toBe(0);
    expect(periodStartMs('', now)).toBe(0);
  });

  test('uses current time when now is omitted (result is in the past)', () => {
    const before = Date.now() - 7 * DAY_MS;
    const result = periodStartMs('1W');
    const after  = Date.now() - 7 * DAY_MS;
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after + 50); // allow 50ms execution time
  });
});
