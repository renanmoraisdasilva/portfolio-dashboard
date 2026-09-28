/**
 * Analytics Lab math.
 *
 * Lifted verbatim out of `static/js/lib/analytics-insights.js` when the page
 * moved to Vue (Phase 5) — same thresholds, same rounding, same order of
 * operations, so the numbers on screen are unchanged. Only the module format
 * and the types are new.
 *
 * Nothing here touches the DOM, the network or the database: every function is
 * a pure transform of its arguments, which is why it can be unit-tested and
 * reused by both apps.
 */

/** The subset of a `history_points` row these helpers read. */
export interface HistoryPointLike {
  ts?: number | null;
  /** Invested base. */
  i?: number | null;
  /** Unrealized P/L. */
  p?: number | null;
  /** Total portfolio value. */
  v?: number | null;
  brlusd_rate?: number | null;
}

/** A cash ledger row from `GET /api/cash/entries`. */
export interface CashEntryLike {
  ts?: number | null;
  currency?: string | null;
  amount?: number | null;
}

export interface CashAssetPoint {
  ts: number;
  cashUSD: number;
  assetsUSD: number;
  totalUSD: number;
}

export interface CashCurrencyPoint {
  ts: number;
  cashBRL: number;
  cashUSDNative: number;
}

export interface CorrelatedAxis {
  fx: number;
  yBRLMax: number;
  yUSDMax: number;
  ratio: number;
}

export interface RiskProfileInput {
  drawdownPct?: number | null;
  sharpeRatio?: number | null;
  cashPct?: number | null;
  deployableCashPct?: number | null;
  emergencyCoverage?: number | null;
  maxAssetAllocPct?: number | null;
  periodReturnPct?: number | null;
  pnlStdPct?: number | null;
}

export interface RiskProfileComponents {
  ddRisk: number;
  sharpeRisk: number;
  concentrationRisk: number;
  volRisk: number;
  deployableCashRisk: number;
  emergencyShortfallRisk: number;
  cashBufferCredit: number;
}

export interface RiskProfile {
  score: number;
  label: string;
  components: RiskProfileComponents;
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function byTs(a: { ts?: number | null }, b: { ts?: number | null }): number {
  return toNumber(a.ts, 0) - toNumber(b.ts, 0);
}

/**
 * Splits each history point into cash and assets in USD.
 *
 * Cash is the running sum of the ledger up to that point, converted with the
 * row's own `brlusd_rate` — so a cash backfill or deposit is never mistaken for
 * performance.
 */
export function buildCashAssetSeries(
  historyPoints: readonly HistoryPointLike[] | null | undefined,
  cashEntries: readonly CashEntryLike[] | null | undefined,
  defaultBrlUsd: number,
): CashAssetPoint[] {
  const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
  const entries = Array.isArray(cashEntries) ? [...cashEntries] : [];
  points.sort(byTs);
  entries.sort(byTs);

  let idx = 0;
  let cashBRL = 0;
  let cashUSDNative = 0;
  const out: CashAssetPoint[] = [];

  for (const p of points) {
    const ts = toNumber(p.ts, 0);
    while (idx < entries.length && toNumber(entries[idx].ts, 0) <= ts) {
      const e = entries[idx];
      const amount = toNumber(e.amount, 0);
      if (e.currency === 'BRL') cashBRL += amount;
      if (e.currency === 'USD') cashUSDNative += amount;
      idx++;
    }

    const fx = toNumber(p.brlusd_rate, toNumber(defaultBrlUsd, 1));
    const cashUSD = cashUSDNative + cashBRL * fx;
    const totalUSD = toNumber(p.v, 0);
    const assetsUSD = Math.max(0, totalUSD - cashUSD);

    out.push({ ts, cashUSD, assetsUSD, totalUSD });
  }

  return out;
}

/** Same walk, but keeping the two native cash currencies apart. */
export function buildCashCurrencySeries(
  historyPoints: readonly HistoryPointLike[] | null | undefined,
  cashEntries: readonly CashEntryLike[] | null | undefined,
): CashCurrencyPoint[] {
  const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
  const entries = Array.isArray(cashEntries) ? [...cashEntries] : [];
  points.sort(byTs);
  entries.sort(byTs);

  let idx = 0;
  let runningCashBRL = 0;
  let runningCashUSDNative = 0;
  const out: CashCurrencyPoint[] = [];

  for (const p of points) {
    const ts = toNumber(p.ts, 0);
    while (idx < entries.length && toNumber(entries[idx].ts, 0) <= ts) {
      const e = entries[idx];
      const amount = toNumber(e.amount, 0);
      if (e.currency === 'BRL') runningCashBRL += amount;
      if (e.currency === 'USD') runningCashUSDNative += amount;
      idx++;
    }
    out.push({ ts, cashBRL: runningCashBRL, cashUSDNative: runningCashUSDNative });
  }

  return out;
}

/**
 * Maxima for the dual-axis cash chart, locked to one FX ratio so the BRL and
 * USD lines stay visually comparable as the rate moves.
 */
export function computeCorrelatedAxisMax(
  cashBRLSeries: readonly number[] | null | undefined,
  cashUSDSeries: readonly number[] | null | undefined,
  fxRef: number,
  paddingFactor: number,
): CorrelatedAxis {
  const brl = Array.isArray(cashBRLSeries) ? cashBRLSeries : [];
  const usd = Array.isArray(cashUSDSeries) ? cashUSDSeries : [];
  const padding = toNumber(paddingFactor, 1.08);
  const fxRaw = toNumber(fxRef, 1);
  const fx = fxRaw > 0 ? fxRaw : 1;

  const maxBRL = brl.length ? Math.max(...brl.map((v) => toNumber(v, 0))) : 0;
  const maxUSD = usd.length ? Math.max(...usd.map((v) => toNumber(v, 0))) : 0;
  const unifiedMaxBRL = Math.max(maxBRL, maxUSD / fx);
  const yBRLMax = Math.max(1, unifiedMaxBRL * padding);
  const yUSDMax = yBRLMax * fx;

  return {
    fx,
    yBRLMax,
    yUSDMax,
    ratio: yUSDMax / yBRLMax,
  };
}

/**
 * Per-step P/L returns as `ΔP/L ÷ previous invested base`. Used for the
 * volatility term of the risk score — raw P/L deltas would let deposits move it.
 */
export function computePnlReturns(historyPoints: readonly HistoryPointLike[] | null | undefined): number[] {
  const points = Array.isArray(historyPoints) ? [...historyPoints] : [];
  points.sort(byTs);

  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prevI = toNumber(points[i - 1].i, 0);
    const prevP = toNumber(points[i - 1].p, NaN);
    const currP = toNumber(points[i].p, NaN);
    if (prevI <= 0 || !Number.isFinite(prevP) || !Number.isFinite(currP)) continue;
    returns.push((currP - prevP) / prevI);
  }
  return returns;
}

/** Population standard deviation; 0 for an empty series. */
export function stdDev(values: readonly number[] | null | undefined): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const mean = values.reduce((s, x) => s + x, 0) / values.length;
  const variance = values.reduce((s, x) => s + (x - mean) * (x - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Weighted 0–100 risk score. Each input is a risk *penalty* except
 * `cashBufferCredit`, which subtracts: a funded emergency buffer genuinely
 * lowers portfolio risk, so it must not read as a penalty.
 */
export function computeRiskProfile(input: RiskProfileInput): RiskProfile {
  const drawdownPct = toNumber(input.drawdownPct, 0);
  const sharpeRatio = toNumber(input.sharpeRatio, 0);
  const deployableCashPct = toNumber(input.deployableCashPct, 0);
  const emergencyCoverage = toNumber(input.emergencyCoverage, 0);
  const maxAssetAllocPct = toNumber(input.maxAssetAllocPct, 0);
  const periodReturnPct = toNumber(input.periodReturnPct, 0);
  const pnlStdPct = toNumber(input.pnlStdPct, 0);

  const ddRisk = Math.min(35, drawdownPct * 1.8);

  let sharpeRisk = 12;
  if (sharpeRatio >= 1.5) sharpeRisk = 0;
  else if (sharpeRatio >= 1) sharpeRisk = 4;
  else if (sharpeRatio >= 0.5) sharpeRisk = 10;
  else if (sharpeRatio >= 0) sharpeRisk = 18;
  else if (sharpeRatio >= -1) sharpeRisk = 28;
  else sharpeRisk = 35;

  const concentrationRisk = Math.min(20, Math.max(0, maxAssetAllocPct - 35) * 0.9);
  const volRisk = Math.min(20, pnlStdPct * 5.0);

  // Opportunity-cost risk is attached only to deployable cash, not the protected emergency buffer.
  let deployableCashRisk;
  if (periodReturnPct >= 0) {
    deployableCashRisk = Math.min(12, deployableCashPct * 0.35);
  } else {
    deployableCashRisk = Math.min(5, deployableCashPct * 0.12);
  }

  // Cash buffer provides downside protection and should reduce overall market risk.
  const cashBufferCredit = emergencyCoverage >= 1 ? Math.min(12, 6 + (emergencyCoverage - 1) * 6) : 0;
  const emergencyShortfallRisk = emergencyCoverage < 1 ? Math.min(15, (1 - emergencyCoverage) * 15) : 0;

  const rawScore =
    ddRisk + sharpeRisk + concentrationRisk + volRisk + deployableCashRisk + emergencyShortfallRisk - cashBufferCredit;
  const score = Math.max(0, Math.min(100, rawScore));

  let label = 'Low';
  if (score >= 70) label = 'Very High';
  else if (score >= 55) label = 'High';
  else if (score >= 35) label = 'Moderate';

  return {
    score,
    label,
    components: {
      ddRisk,
      sharpeRisk,
      concentrationRisk,
      volRisk,
      deployableCashRisk,
      emergencyShortfallRisk,
      cashBufferCredit,
    },
  };
}
