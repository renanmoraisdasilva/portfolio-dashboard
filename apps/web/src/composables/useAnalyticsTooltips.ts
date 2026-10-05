import type { AnalyticsSnapshot } from '../stores/analytics';

export interface TooltipContent {
  title: string;
  body: string;
  value?: { text: string; color: string };
  hints?: string[];
  scale?: { label: string; kind: 'bad' | 'ok' | 'good' | 'great' }[];
  footer?: string[];
}

function fmtSignedUSD(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value >= 0 ? '+' : '−';
  return sign + '$' + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtUSD(value: number | null | undefined): string {
  if (value == null) return '—';
  return '$' + Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return '?';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysBetween(a: number, b: number): number {
  return Math.round(Math.abs(b - a) / 86_400_000);
}

export function useAnalyticsTooltips() {
  return { returnTooltip, drawdownTooltip, sharpeTooltip };
}

function returnTooltip(snap: AnalyticsSnapshot | null): TooltipContent {
  const ret = snap?.return_pct ?? null;
  if (ret == null) {
    return {
      title: 'P/L Return on Invested Capital',
      body: 'Not enough snapshot history to compute return for this period.',
      hints: [],
    };
  }
  const sign = ret >= 0 ? '+' : '';
  const verdict =
    ret >= 20
      ? 'Strong gain'
      : ret >= 5
        ? 'Modest gain'
        : ret >= 0
          ? 'Flat / slight gain'
          : ret >= -10
            ? 'Slight loss'
            : ret >= -50
              ? 'Significant loss'
              : 'Severe loss';
  const color = ret >= 0 ? 'var(--accent-success)' : ret >= -20 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  const inputs = snap?.return_inputs ?? null;
  const hints = ['Formula: (P/L_end − P/L_start + Interest_period) ÷ Invested_start.'];
  if (inputs) {
    hints.push(
      `Values: (${fmtSignedUSD(inputs.end_pnl)} − ${fmtSignedUSD(inputs.start_pnl)} + ${fmtSignedUSD(inputs.interest_period_usd)}) ÷ ${fmtUSD(inputs.start_invested)} = ${sign}${ret.toFixed(1)}%`,
    );
  }
  return {
    title: 'P/L Return on Invested Capital',
    body: 'Measures how much your snapshot P/L changed across the period, plus interest gains recorded for the period, relative to the invested base at the period start.',
    value: { text: `${sign}${ret.toFixed(1)}% — ${verdict}`, color },
    hints,
  };
}

function drawdownTooltip(snap: AnalyticsSnapshot | null): TooltipContent {
  const dd = snap?.max_drawdown_pct ?? null;
  if (dd == null) {
    return {
      title: 'Maximum Drawdown',
      body: 'No drawdown recorded — the portfolio never fell from a prior peak during this period. All movement was upward.',
      hints: [],
    };
  }
  const start = snap?.max_drawdown_start ?? null;
  const end = snap?.max_drawdown_end ?? null;
  const severity =
    dd < 5
      ? 'Minimal — very stable'
      : dd < 10
        ? 'Low — normal volatility'
        : dd < 20
          ? 'Moderate — typical for equities'
          : dd < 35
            ? 'Significant — worth reviewing risk'
            : 'Severe — high loss exposure';
  const color = dd < 10 ? 'var(--accent-success)' : dd < 20 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  const inputs = snap?.drawdown_inputs ?? null;
  const hints: string[] = [];
  if (inputs) {
    const peak = Number(inputs.peak_value ?? 0);
    const trough = Number(inputs.trough_value ?? 0);
    hints.push(
      `Formula values: (${peak.toFixed(4)} − ${trough.toFixed(4)}) ÷ ${peak.toFixed(4)} = −${dd.toFixed(1)}% · ${inputs.points_count ?? 0} daily closes used`,
    );
  }
  if (start && end) {
    const days = daysBetween(start, end);
    hints.push(
      `Peak on ${fmtDate(start)} → ${fmtDate(end)} · ${days} day${days !== 1 ? 's' : ''} to reach the trough. A smaller drawdown with a shorter recovery window is healthier.`,
    );
  }
  return {
    title: 'Maximum Drawdown',
    body: 'The largest peak-to-trough decline in a daily cumulative return index built from P/L returns (ΔP/L ÷ previous invested base). This avoids distortion from cash deposits and raw P/L level changes.',
    value: { text: `−${dd.toFixed(1)}% — ${severity}`, color },
    hints,
  };
}

function sharpeTooltip(snap: AnalyticsSnapshot | null): TooltipContent {
  const sr = snap?.sharpe_ratio ?? null;
  if (sr == null) {
    return {
      title: 'Sharpe Ratio',
      body: 'Requires at least 30 consecutive snapshot data points. The server snapshots every 30 min — you need ~15 hours of continuous history for this period.',
    };
  }
  const scale = [
    { label: '< 0 Poor', kind: 'bad' as const },
    { label: '0–0.5 Low', kind: 'ok' as const },
    { label: '0.5–1 OK', kind: 'ok' as const },
    { label: '1–2 Good', kind: 'good' as const },
    { label: '> 2 Excellent', kind: 'great' as const },
  ];
  const verdict =
    sr >= 2
      ? 'Excellent risk-adjusted return'
      : sr >= 1
        ? 'Good — beats risk-free with low volatility'
        : sr >= 0.5
          ? 'Acceptable — modest risk premium'
          : sr >= 0
            ? 'Below average — barely above risk-free'
            : sr >= -1
              ? 'Poor — underperforming a savings account'
              : 'Very poor — deeply below risk-free';
  const color = sr >= 1 ? 'var(--accent-success)' : sr >= 0.5 ? 'var(--accent-warning)' : 'var(--accent-danger)';
  const inputs = snap?.sharpe_inputs ?? null;
  const hints = [
    'A negative Sharpe means you would have earned more by holding a risk-free fixed-income instrument (e.g. Tesouro Selic) than taking on this portfolio’s volatility.',
  ];
  if (inputs) {
    hints.unshift(
      `Values: mean=${(Number(inputs.mean_return ?? 0) * 100).toFixed(4)}% · std=${(Number(inputs.std_return ?? 0) * 100).toFixed(4)}% · n=${inputs.observations ?? 0} · rf/period=${(Number(inputs.rf_per_period ?? 0) * 100).toFixed(4)}%`,
    );
  }
  return {
    title: 'Sharpe Ratio',
    body: 'Annualised excess return (vs risk-free 4.5%/yr) divided by volatility, using per-period P/L returns: ΔP/L ÷ prior invested base.',
    value: { text: `${sr.toFixed(2)} — ${verdict}`, color },
    scale,
    footer: hints,
  };
}
