/**
 * analyticsService.ts — Analytics Lab batch computation service.
 *
 * Pure exported functions (no I/O, fully testable in isolation):
 *   medianInterval, computeReturnPct, computeMaxDrawdown,
 *   computeSharpeRatio, periodStartMs
 *
 * DB-level orchestration (not unit-tested, covered by integration):
 *   refreshAllPeriods, getLatestSnapshots
 */

import { randomUUID } from 'node:crypto';
import { run, get, all } from '../db';
import { replayFIFOLots, isBRLNonBond } from './portfolioCalculator';

// ─── Types ────────────────────────────────────────────────────────────────────

export const PERIODS = ['1W', '1M', '3M', '1Y', 'ALL'] as const;
export type Period = (typeof PERIODS)[number];

export interface SnapshotPoint {
  ts: number;
  v: number;
}

export interface SnapshotPnLPoint {
  ts: number;
  i: number;
  p: number;
}

export interface MaxDrawdown {
  /** Magnitude of the maximum drawdown as a positive percentage, e.g. 12.7 means −12.7%. */
  pct: number;
  /** Timestamp of the peak value (drawdown start). */
  startTs: number;
  /** Timestamp of the trough value (drawdown end). */
  endTs: number;
  /** Value at the peak point. */
  startV?: number;
  /** Value at the trough point. */
  endV?: number;
}

export interface CashFlowEvent {
  /** Unix-ms timestamp of the deposit or withdrawal. */
  ts: number;
  /** Signed amount in USD. Positive = deposit into portfolio; negative = withdrawal. */
  amountUSD: number;
}

export interface CostVsMarket {
  cost: number;
  market: number;
}

interface InterestEvent {
  ts: number;
  amountUSD: number;
}

export interface AnalyticsSnapshot {
  id: string;
  computed_at: number;
  period: Period;
  return_pct: number | null;
  max_drawdown_pct: number | null;
  max_drawdown_start: number | null;
  max_drawdown_end: number | null;
  sharpe_ratio: number | null;
  allocation_json: string | null;
  cost_vs_market_json: string | null;
  return_inputs?: ReturnInputs | null;
  drawdown_inputs?: DrawdownInputs | null;
  sharpe_inputs?: SharpeInputs | null;
}

export interface ReturnInputs {
  start_ts: number;
  end_ts: number;
  start_invested: number;
  start_pnl: number;
  end_pnl: number;
  interest_period_usd: number;
  numerator_usd: number;
}

export interface DrawdownInputs {
  series: 'daily_close_pnl_return_index';
  points_count: number;
  peak_ts: number;
  trough_ts: number;
  peak_value: number;
  trough_value: number;
}

export interface SharpeInputs {
  observations: number;
  mean_return: number;
  std_return: number;
  periods_per_year: number;
  rf_per_period: number;
}

export interface SharpeStats extends SharpeInputs {
  sharpe: number;
}

// ─── Pure helpers (exported for unit tests) ───────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Returns the median of the differences between consecutive sorted timestamps.
 * Returns 0 when fewer than 2 timestamps are provided.
 */
export function medianInterval(sortedTs: number[]): number {
  if (sortedTs.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < sortedTs.length; i++) {
    diffs.push(sortedTs[i] - sortedTs[i - 1]);
  }
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  return diffs.length % 2 === 0 ? (diffs[mid - 1] + diffs[mid]) / 2 : diffs[mid];
}

/**
 * Returns (endValue − startValue) / startValue × 100.
 * Returns null when fewer than 2 points exist or the start value is zero.
 */
export function computeReturnPct(points: SnapshotPoint[]): number | null {
  if (points.length < 2) return null;
  const start = points[0].v;
  const end = points[points.length - 1].v;
  if (start === 0) return null;
  return ((end - start) / start) * 100;
}

/**
 * Computes return from the change in snapshot P/L (p) relative to the initial
 * invested-net base (i). This tracks investment performance while avoiding
 * false gains from new capital added during the period.
 */
export function computePnLReturnPct(
  points: SnapshotPnLPoint[],
  periodInterestUSD = 0,
): number | null {
  if (points.length < 2) return null;
  const startI = points[0].i;
  const startP = points[0].p;
  const endP = points[points.length - 1].p;
  if (!Number.isFinite(startI) || startI <= 0) return null;
  if (!Number.isFinite(startP) || !Number.isFinite(endP)) return null;
  return ((endP - startP + periodInterestUSD) / startI) * 100;
}

/**
 * Computes the Time-Weighted Return (TWR) for a series of portfolio snapshots,
 * stripping out the effect of external cash flows (deposits / withdrawals).
 *
 * For each consecutive snapshot pair the sub-period return is adjusted by
 * deducting any cash flows that occurred in that interval from the ending
 * value before computing the ratio.  This measures pure investment
 * performance regardless of when money was added or removed.
 *
 * Returns null when fewer than 2 points exist, the first value is zero, or
 * no valid sub-periods can be computed.
 */
export function computeTWR(
  points: SnapshotPoint[],
  cashFlows: CashFlowEvent[] = [],
): number | null {
  if (points.length < 2) return null;
  if (points[0].v === 0) return null;

  const sortedFlows = [...cashFlows].sort((a, b) => a.ts - b.ts);

  let chainedFactor = 1;
  let validSubPeriods = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev.v <= 0) continue;

    // Sum cash flows strictly in (prev.ts, curr.ts]
    let cfSum = 0;
    for (const f of sortedFlows) {
      if (f.ts <= prev.ts) continue;
      if (f.ts > curr.ts) break;
      cfSum += f.amountUSD;
    }

    chainedFactor *= (curr.v - cfSum) / prev.v;
    validSubPeriods++;
  }

  if (validSubPeriods === 0) return null;
  return (chainedFactor - 1) * 100;
}

/**
 * Returns a synthetic equity curve where external cash flows are removed from
 * each point's value. This keeps the curve comparable across time and lets
 * drawdown metrics reflect investment performance rather than deposits.
 */
export function buildFlowAdjustedPoints(
  points: SnapshotPoint[],
  cashFlows: CashFlowEvent[] = [],
): SnapshotPoint[] {
  if (points.length === 0) return [];

  const sortedFlows = [...cashFlows].sort((a, b) => a.ts - b.ts);
  const adjusted: SnapshotPoint[] = [];
  let flowIdx = 0;
  let cumulativeFlows = 0;

  for (const p of points) {
    while (flowIdx < sortedFlows.length && sortedFlows[flowIdx].ts <= p.ts) {
      cumulativeFlows += sortedFlows[flowIdx].amountUSD;
      flowIdx++;
    }
    adjusted.push({ ts: p.ts, v: p.v - cumulativeFlows });
  }

  return adjusted;
}

/**
 * Compresses a time series to one point per UTC day, keeping the last point
 * of each day (daily close). This removes intraday wick-like noise from
 * drawdown calculations.
 */
export function toDailyClosePoints(points: SnapshotPoint[]): SnapshotPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const closesByDay = new Map<number, SnapshotPoint>();
  for (const p of sorted) {
    const dayKey = Math.floor(p.ts / DAY_MS);
    closesByDay.set(dayKey, p);
  }
  return Array.from(closesByDay.values());
}

/**
 * Daily-close series for snapshot P/L values (p), used for drawdown so
 * portfolio value totals (which include capital base changes) do not distort
 * risk measurements.
 */
export function toDailyClosePnLPoints(points: SnapshotPnLPoint[]): SnapshotPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const closesByDay = new Map<number, SnapshotPoint>();
  for (const p of sorted) {
    const dayKey = Math.floor(p.ts / DAY_MS);
    closesByDay.set(dayKey, { ts: p.ts, v: p.p });
  }
  return Array.from(closesByDay.values());
}

/**
 * Keeps the last SnapshotPnLPoint per UTC day.
 */
export function toDailyClosePnLInputs(points: SnapshotPnLPoint[]): SnapshotPnLPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const closesByDay = new Map<number, SnapshotPnLPoint>();
  for (const p of sorted) {
    const dayKey = Math.floor(p.ts / DAY_MS);
    closesByDay.set(dayKey, p);
  }
  return Array.from(closesByDay.values());
}

/**
 * Builds a cumulative return index from P/L returns where each sub-period
 * return is delta(P/L) / previous invested base.
 *
 * Index starts at 1.0 and is chained multiplicatively.
 */
export function buildPnLReturnIndexPoints(points: SnapshotPnLPoint[]): SnapshotPoint[] {
  if (points.length === 0) return [];

  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const out: SnapshotPoint[] = [{ ts: sorted[0].ts, v: 1 }];
  let idx = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!Number.isFinite(prev.i) || prev.i <= 0) continue;
    if (!Number.isFinite(prev.p) || !Number.isFinite(curr.p)) continue;

    idx *= 1 + (curr.p - prev.p) / prev.i;
    out.push({ ts: curr.ts, v: idx });
  }

  return out;
}

/**
 * Walks all snapshot points and returns the largest peak-to-trough drawdown.
 * Returns null when fewer than 2 points are available or no drawdown exists.
 */
export function computeMaxDrawdown(points: SnapshotPoint[]): MaxDrawdown | null {
  if (points.length < 2) return null;

  let peak = points[0].v;
  let peakTs = points[0].ts;
  let maxDD = 0;
  let maxDDStart = points[0].ts;
  let maxDDEnd = points[0].ts;

  for (let i = 1; i < points.length; i++) {
    const { ts, v } = points[i];
    if (v >= peak) {
      peak = v;
      peakTs = ts;
    } else {
      const dd = ((peak - v) / peak) * 100;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDStart = peakTs;
        maxDDEnd = ts;
      }
    }
  }

  if (maxDD === 0) return null;
  const startV = points.find(p => p.ts === maxDDStart)?.v;
  const endV = points.find(p => p.ts === maxDDEnd)?.v;
  return { pct: maxDD, startTs: maxDDStart, endTs: maxDDEnd, startV, endV };
}

/**
 * Computes the annualised Sharpe ratio from a series of portfolio snapshots.
 *
 * - Uses TWR-adjusted returns between consecutive, normally-spaced pairs,
 *   stripping out any cash flows that fall within each interval.
 * - Skips pairs whose gap exceeds 2.5× the median interval (server-restart gaps).
 * - Returns null when fewer than 30 valid return observations are available.
 * - Annualises with √(periodsPerYear) derived from the median snapshot interval.
 *
 * @param annualRiskFreeRate  Annual risk-free rate, default 4.5% (Selic proxy).
 * @param cashFlows           Optional deposit/withdrawal events to strip out.
 */
export function computeSharpeRatio(
  points: SnapshotPoint[],
  annualRiskFreeRate = 0.045,
  cashFlows: CashFlowEvent[] = [],
): number | null {
  if (points.length < 2) return null;

  const median = medianInterval(points.map(p => p.ts));
  if (median <= 0) return null;
  const threshold = 2.5 * median;

  const sortedFlows = [...cashFlows].sort((a, b) => a.ts - b.ts);

  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].ts - points[i - 1].ts;
    if (gap <= 0 || gap > threshold) continue;
    if (points[i - 1].v <= 0) continue;

    // Strip cash flows from this sub-period
    let cfSum = 0;
    for (const f of sortedFlows) {
      if (f.ts <= points[i - 1].ts) continue;
      if (f.ts > points[i].ts) break;
      cfSum += f.amountUSD;
    }

    returns.push((points[i].v - cfSum - points[i - 1].v) / points[i - 1].v);
  }

  if (returns.length < 30) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std < 1e-12) return null;

  const periodsPerYear = (365 * DAY_MS) / median;
  const rfPerPeriod = annualRiskFreeRate / periodsPerYear;
  return ((mean - rfPerPeriod) / std) * Math.sqrt(periodsPerYear);
}

/**
 * Computes annualised Sharpe ratio from period-over-period P/L returns,
 * where each sub-period return is delta(P/L) divided by prior invested base.
 *
 * This keeps Sharpe aligned with computePnLReturnPct and avoids mixing a
 * value-based risk metric with a P/L-based return headline metric.
 */
export function computePnLSharpeRatio(
  points: SnapshotPnLPoint[],
  annualRiskFreeRate = 0.045,
): number | null {
  const stats = computePnLSharpeStats(points, annualRiskFreeRate);
  return stats?.sharpe ?? null;
}

export function computePnLSharpeStats(
  points: SnapshotPnLPoint[],
  annualRiskFreeRate = 0.045,
): SharpeStats | null {
  if (points.length < 2) return null;

  const median = medianInterval(points.map(p => p.ts));
  if (median <= 0) return null;
  const threshold = 2.5 * median;

  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const gap = points[i].ts - points[i - 1].ts;
    if (gap <= 0 || gap > threshold) continue;

    const prevI = points[i - 1].i;
    if (!Number.isFinite(prevI) || prevI <= 0) continue;
    const prevP = points[i - 1].p;
    const currP = points[i].p;
    if (!Number.isFinite(prevP) || !Number.isFinite(currP)) continue;

    returns.push((currP - prevP) / prevI);
  }

  if (returns.length < 30) return null;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std < 1e-12) return null;

  const periodsPerYear = (365 * DAY_MS) / median;
  const rfPerPeriod = annualRiskFreeRate / periodsPerYear;
  const sharpe = ((mean - rfPerPeriod) / std) * Math.sqrt(periodsPerYear);
  return {
    sharpe,
    observations: returns.length,
    mean_return: mean,
    std_return: std,
    periods_per_year: periodsPerYear,
    rf_per_period: rfPerPeriod,
  };
}

/**
 * Returns the Unix-ms start timestamp for a given analytics period relative to `now`.
 * 'ALL' returns 0 (no lower bound).
 */
export function periodStartMs(period: Period | string, now = Date.now()): number {
  switch (period) {
    case '1W':  return now - 7   * DAY_MS;
    case '1M':  return now - 30  * DAY_MS;
    case '3M':  return now - 90  * DAY_MS;
    case '1Y':  return now - 365 * DAY_MS;
    default:    return 0; // ALL
  }
}

// ─── DB-level orchestration ───────────────────────────────────────────────────

/** Returns the latest analytics snapshots for all 5 periods. */
export async function getLatestSnapshots(): Promise<AnalyticsSnapshot[]> {
  const snapshots = await all<AnalyticsSnapshot>('SELECT * FROM analytics_snapshots ORDER BY period');

  const allSnapshots: any[] = await all(
    'SELECT ts, v, i, p, brlusd_rate FROM portfolio_snapshots WHERE v IS NOT NULL ORDER BY ts ASC',
  );
  const priceRows: any[] = await all('SELECT symbol, price FROM price_cache');
  const cashEntryRows: any[] = await all(
    `SELECT currency, amount, ts, description
       FROM cash
      WHERE LOWER(TRIM(COALESCE(description, ''))) != 'cash backfill estimate'
      ORDER BY ts ASC`,
  );
  const interestRows: any[] = await all(
    'SELECT month, currency, amount, created_at FROM interest ORDER BY created_at ASC',
  );

  const now = Date.now();
  const prices: Record<string, number> = {};
  for (const r of priceRows) prices[r.symbol] = r.price;
  const currentBrlUsd = prices['BRLUSD'] ?? 1;

  const allCashFlows: CashFlowEvent[] = [];
  {
    let snapIdx = 0;
    for (const row of cashEntryRows) {
      const rowTs = row.ts as number;
      while (snapIdx < allSnapshots.length && (allSnapshots[snapIdx].ts as number) < rowTs) {
        snapIdx++;
      }
      const nextSnap = snapIdx < allSnapshots.length ? allSnapshots[snapIdx] : null;
      const brlRate: number =
        nextSnap?.brlusd_rate != null ? (nextSnap.brlusd_rate as number) : currentBrlUsd;
      const amountUSD = row.currency === 'BRL' ? (row.amount as number) * brlRate : (row.amount as number);
      allCashFlows.push({ ts: rowTs, amountUSD });
    }
  }

  function monthToEventTs(month: unknown, fallbackTs: number): number {
    if (typeof month !== 'string') return fallbackTs;
    const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
    if (!m) return fallbackTs;
    const year = Number(m[1]);
    const mon = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(mon) || mon < 1 || mon > 12) return fallbackTs;
    return Date.UTC(year, mon, 0, 23, 59, 59, 999);
  }

  const interestEvents: InterestEvent[] = [];
  {
    let snapIdx = 0;
    for (const row of interestRows) {
      const amount = Number(row.amount ?? 0);
      if (!Number.isFinite(amount) || amount === 0) continue;

      const createdAt = Number(row.created_at ?? 0);
      const tsFallback = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now;
      const eventTs = monthToEventTs(row.month, tsFallback);

      while (snapIdx < allSnapshots.length && (allSnapshots[snapIdx].ts as number) < eventTs) {
        snapIdx++;
      }
      const nextSnap = snapIdx < allSnapshots.length ? allSnapshots[snapIdx] : null;
      const brlRate: number =
        nextSnap?.brlusd_rate != null ? (nextSnap.brlusd_rate as number) : currentBrlUsd;
      const amountUSD = row.currency === 'BRL' ? amount * brlRate : amount;
      interestEvents.push({ ts: eventTs, amountUSD });
    }
  }

  const byPeriod = new Map<string, AnalyticsSnapshot>();
  for (const s of snapshots) byPeriod.set(s.period, s);

  for (const period of PERIODS) {
    const row = byPeriod.get(period);
    if (!row) continue;

    const startTs = periodStartMs(period, now);
    const points: SnapshotPoint[] = allSnapshots
      .filter(s => typeof s.ts === 'number' && s.ts >= startTs)
      .map(s => ({ ts: s.ts as number, v: s.v as number }));
    const pnlPoints: SnapshotPnLPoint[] = allSnapshots
      .filter(s => typeof s.ts === 'number' && s.ts >= startTs)
      .map(s => ({ ts: s.ts as number, i: Number(s.i ?? 0), p: Number(s.p ?? 0) }));

    const cashFlows = allCashFlows.filter(f => f.ts >= startTs);
    const periodInterestUSD = interestEvents
      .filter(e => e.ts >= startTs && e.ts <= now)
      .reduce((sum, e) => sum + e.amountUSD, 0);

    const dailyPnLInputs = toDailyClosePnLInputs(pnlPoints);
    const drawdownSeries = buildPnLReturnIndexPoints(dailyPnLInputs);
    const dd = computeMaxDrawdown(drawdownSeries);
    const sharpeStats = computePnLSharpeStats(pnlPoints, 0.045);

    if (pnlPoints.length >= 2) {
      const start = pnlPoints[0];
      const end = pnlPoints[pnlPoints.length - 1];
      row.return_inputs = {
        start_ts: start.ts,
        end_ts: end.ts,
        start_invested: start.i,
        start_pnl: start.p,
        end_pnl: end.p,
        interest_period_usd: periodInterestUSD,
        numerator_usd: end.p - start.p + periodInterestUSD,
      };
    } else {
      row.return_inputs = null;
    }

    row.drawdown_inputs = dd
      ? {
          series: 'daily_close_pnl_return_index',
          points_count: drawdownSeries.length,
          peak_ts: dd.startTs,
          trough_ts: dd.endTs,
          peak_value: dd.startV ?? 0,
          trough_value: dd.endV ?? 0,
        }
      : null;

    row.sharpe_inputs = sharpeStats
      ? {
          observations: sharpeStats.observations,
          mean_return: sharpeStats.mean_return,
          std_return: sharpeStats.std_return,
          periods_per_year: sharpeStats.periods_per_year,
          rf_per_period: sharpeStats.rf_per_period,
        }
      : null;
  }

  return snapshots;
}

/**
 * Computes analytics for all periods using portfolio_snapshots + trades + price_cache,
 * then upserts one row per period into analytics_snapshots.
 *
 * Safe to call repeatedly — always overwrites with the latest computation.
 * No external API calls; uses only data already in the DB.
 */
export async function refreshAllPeriods(): Promise<void> {
  const allSnapshots: any[] = await all(
    'SELECT ts, v, i, p, brlusd_rate FROM portfolio_snapshots WHERE v IS NOT NULL ORDER BY ts ASC',
  );
  const trades: any[] = await all('SELECT * FROM trades ORDER BY time ASC');
  const priceRows: any[] = await all('SELECT symbol, price FROM price_cache');
  const interestRows: any[] = await all(
    'SELECT month, currency, amount, created_at FROM interest ORDER BY created_at ASC',
  );
  // Load cash entries for historical cash lookup (ordered ASC for prefix-sum scan)
  const cashEntryRows: any[] = await all(
    `SELECT currency, amount, ts, description
       FROM cash
      WHERE LOWER(TRIM(COALESCE(description, ''))) != 'cash backfill estimate'
      ORDER BY ts ASC`,
  );

  const prices: Record<string, number> = {};
  for (const r of priceRows) prices[r.symbol] = r.price;

  const now = Date.now();
  const currentBrlUsd = prices['BRLUSD'] ?? 1;

  /**
   * Build cash flow events directly from the cash entry ledger.
   *
   * Using cash entries directly (rather than snapshot-pair deltas) ensures every
   * deposit and withdrawal is captured regardless of its size, and avoids false
   * positives caused by BRL/USD rate fluctuations on existing cash balances
   * being misidentified as deposits.
   *
   * For BRL entries, the USD amount is computed using the BRLUSD rate from the
   * first portfolio snapshot at or after the cash entry's timestamp, which
   * matches how the deposit's effect appears in the next `v` snapshot value.
   * Falls back to the current rate when no later snapshot exists.
   */
  const allCashFlows: CashFlowEvent[] = [];
  {
    let snapIdx = 0;
    for (const row of cashEntryRows) {
      const rowTs = row.ts as number;
      // Advance two-pointer to the first snapshot at or after this cash entry's ts
      while (snapIdx < allSnapshots.length && (allSnapshots[snapIdx].ts as number) < rowTs) {
        snapIdx++;
      }
      const nextSnap = snapIdx < allSnapshots.length ? allSnapshots[snapIdx] : null;
      const brlRate: number =
        nextSnap?.brlusd_rate != null ? (nextSnap.brlusd_rate as number) : currentBrlUsd;
      const amountUSD =
        row.currency === 'BRL'
          ? (row.amount as number) * brlRate
          : (row.amount as number);
      allCashFlows.push({ ts: rowTs, amountUSD });
    }
  }

  function monthToEventTs(month: unknown, fallbackTs: number): number {
    if (typeof month !== 'string') return fallbackTs;
    const m = /^(\d{4})-(\d{2})$/.exec(month.trim());
    if (!m) return fallbackTs;
    const year = Number(m[1]);
    const mon = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(mon) || mon < 1 || mon > 12) return fallbackTs;
    // Use end-of-month UTC so monthly interest is attributed to the month it belongs to.
    return Date.UTC(year, mon, 0, 23, 59, 59, 999);
  }

  const interestEvents: InterestEvent[] = [];
  {
    let snapIdx = 0;
    const fallbackTs = now;
    for (const row of interestRows) {
      const amount = Number(row.amount ?? 0);
      if (!Number.isFinite(amount) || amount === 0) continue;

      const createdAt = Number(row.created_at ?? 0);
      const tsFallback = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : fallbackTs;
      const eventTs = monthToEventTs(row.month, tsFallback);

      while (snapIdx < allSnapshots.length && (allSnapshots[snapIdx].ts as number) < eventTs) {
        snapIdx++;
      }
      const nextSnap = snapIdx < allSnapshots.length ? allSnapshots[snapIdx] : null;
      const brlRate: number =
        nextSnap?.brlusd_rate != null ? (nextSnap.brlusd_rate as number) : currentBrlUsd;

      const amountUSD = row.currency === 'BRL' ? amount * brlRate : amount;
      interestEvents.push({ ts: eventTs, amountUSD });
    }
  }

  // Replay all open FIFO lots for cost-vs-market and allocation
  const lots = replayFIFOLots(trades, prices);

  const costVsMarket: Record<string, CostVsMarket> = {};
  for (const symbol of Object.keys(lots)) {
    const position = lots[symbol];
    const totalQty = position.reduce((s, l) => s + l.qty, 0);
    if (totalQty <= 0) continue;

    const needsBRL = isBRLNonBond(symbol);
    const cost = position.reduce((s, l) => {
      const priceUSD = needsBRL ? l.price * currentBrlUsd : l.price;
      return s + l.qty * priceUSD;
    }, 0);
    const currentPrice = prices[symbol] ?? 0;
    if (currentPrice === 0) continue;
    const marketPriceUSD = needsBRL ? currentPrice * currentBrlUsd : currentPrice;
    costVsMarket[symbol] = { cost, market: totalQty * marketPriceUSD };
  }

  const totalMarket = Object.values(costVsMarket).reduce((s, c) => s + c.market, 0);
  const allocation: Record<string, number> = {};
  for (const sym of Object.keys(costVsMarket)) {
    allocation[sym] = totalMarket > 0 ? costVsMarket[sym].market / totalMarket : 0;
  }

  for (const period of PERIODS) {
    const startTs = periodStartMs(period, now);
    const points: SnapshotPoint[] = allSnapshots
      .filter(s => typeof s.ts === 'number' && s.ts >= startTs)
      .map(s => ({ ts: s.ts as number, v: s.v as number }));
    const pnlPoints: SnapshotPnLPoint[] = allSnapshots
      .filter(s => typeof s.ts === 'number' && s.ts >= startTs)
      .map(s => ({
        ts: s.ts as number,
        i: Number(s.i ?? 0),
        p: Number(s.p ?? 0),
      }));

    const cashFlows = allCashFlows.filter(f => f.ts >= startTs);
    const periodInterestUSD = interestEvents
      .filter(e => e.ts >= startTs && e.ts <= now)
      .reduce((sum, e) => sum + e.amountUSD, 0);
    const dailyPnLInputs = toDailyClosePnLInputs(pnlPoints);
    const drawdownSeries = buildPnLReturnIndexPoints(dailyPnLInputs);

    const returnPct = computePnLReturnPct(pnlPoints, periodInterestUSD);
    const drawdown  = computeMaxDrawdown(drawdownSeries);
    const sharpe    = computePnLSharpeRatio(pnlPoints, 0.045);

    // Reuse existing id for the same period so INSERT OR REPLACE stays idempotent
    const existing: any = await get(
      'SELECT id FROM analytics_snapshots WHERE period = ?',
      [period],
    );
    const id = existing?.id ?? randomUUID();

    await run(
      `INSERT OR REPLACE INTO analytics_snapshots
        (id, computed_at, period, return_pct,
         max_drawdown_pct, max_drawdown_start, max_drawdown_end,
         sharpe_ratio, allocation_json, cost_vs_market_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, now, period,
        returnPct ?? null,
        drawdown?.pct ?? null,
        drawdown?.startTs ?? null,
        drawdown?.endTs ?? null,
        sharpe ?? null,
        JSON.stringify(allocation),
        JSON.stringify(costVsMarket),
      ],
    );
  }
}
