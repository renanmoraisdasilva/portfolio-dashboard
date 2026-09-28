/**
 * Least-squares trend of the portfolio history, extended forward.
 *
 * Phase 6 moved this out of the dashboard store: it is domain maths, it was the
 * one place where the browser derived a value no other surface could check, and
 * it is now covered by tests instead of only being reachable through a toggle.
 *
 * Pure: no DOM, no chart library, no clock of its own — the caller passes the
 * horizon, so the same function answers "60 days" and "182.5 days".
 */

/** Default horizon in days, the half-year the dashboard projects by default. */
export const PROJECTION_DAYS = 182.5;

export interface HistorySample {
  ts?: number | null;
  v?: number | null;
}

export interface ProjectedPoint {
  ts: number;
  v: number;
}

const HOUR_MS = 1000 * 60 * 60;
const DAY_MS = 24 * HOUR_MS;
const MIN_POINTS = 10;
const MAX_POINTS = 200;

export interface ProjectionOptions {
  /** Horizon in days. */
  days?: number;
  /** Fewer samples than this and there is no line to fit. */
  minSamples?: number;
}

/**
 * Fits `value = slope * hours + intercept` over the samples and returns the
 * forward extension of that line.
 *
 * Timestamps are normalised to hours *before* fitting: raw millisecond values
 * lose the precision that keeps the least-squares denominator stable, so a fit
 * over ~10⁹ would be dominated by rounding. The result is clamped at zero —
 * a negative projected portfolio is a modelling artefact, not a forecast.
 *
 * Returns an empty array for fewer than two samples or a degenerate fit, which
 * is what the chart treats as "nothing to draw".
 */
export function computeProjection(history: readonly HistorySample[], options: ProjectionOptions = {}): ProjectedPoint[] {
  const days = options.days ?? PROJECTION_DAYS;
  const minSamples = options.minSamples ?? 2;
  const n = history.length;
  if (n < minSamples) return [];

  const t0 = history[0].ts ?? 0;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    const x = ((history[i].ts ?? 0) - t0) / HOUR_MS;
    const y = history[i].v ?? 0;
    xs[i] = x;
    ys[i] = y;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return [];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const lastTs = history[n - 1].ts ?? 0;
  const durationDays = ((history[n - 1].ts ?? 0) - t0) / DAY_MS || 1;
  const pointsPerDay = n / durationDays;
  const numPoints = Math.min(MAX_POINTS, Math.max(MIN_POINTS, Math.round(pointsPerDay * days)));
  const step = (days * DAY_MS) / numPoints;

  const points: ProjectedPoint[] = [];
  for (let i = 1; i <= numPoints; i++) {
    const ts = lastTs + i * step;
    points.push({ ts, v: Math.max(0, slope * ((ts - t0) / HOUR_MS) + intercept) });
  }
  return points;
}
