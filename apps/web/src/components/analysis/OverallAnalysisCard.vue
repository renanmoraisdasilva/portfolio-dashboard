<script setup lang="ts">
import { computed } from 'vue';
import type { AnalyticsSnapshot } from '../../stores/analytics';

const props = defineProps<{ snap: AnalyticsSnapshot | null }>();

type SignalType = 'good' | 'ok' | 'warning' | 'danger' | 'neutral';
interface Signal {
  type: SignalType;
  text: string;
}

const DOT_COLORS: Record<SignalType, string> = {
  danger: '#ef4444',
  warning: '#f59e0b',
  good: '#22c55e',
  ok: '#4ade80',
  neutral: '#64748b',
};

const THEMES = {
  danger: {
    border: '#ef4444',
    icon: '🔴',
    badge: 'Needs attention',
    badgeBg: 'rgba(239,68,68,0.1)',
    badgeBorder: 'rgba(239,68,68,0.3)',
    color: '#ef4444',
  },
  warning: {
    border: '#f59e0b',
    icon: '🟡',
    badge: 'Mixed signals',
    badgeBg: 'rgba(245,158,11,0.1)',
    badgeBorder: 'rgba(245,158,11,0.3)',
    color: '#f59e0b',
  },
  good: {
    border: '#22c55e',
    icon: '🟢',
    badge: 'On track',
    badgeBg: 'rgba(34,197,94,0.1)',
    badgeBorder: 'rgba(34,197,94,0.3)',
    color: '#22c55e',
  },
  neutral: {
    border: '#64748b',
    icon: '⚪',
    badge: 'Insufficient data',
    badgeBg: 'rgba(100,116,139,0.1)',
    badgeBorder: 'rgba(100,116,139,0.3)',
    color: '#64748b',
  },
} as const;

const signals = computed<Signal[]>(() => {
  const ret = props.snap?.return_pct ?? null;
  const dd = props.snap?.max_drawdown_pct ?? null;
  const sr = props.snap?.sharpe_ratio ?? null;
  const out: Signal[] = [];

  if (ret == null) {
    out.push({ type: 'neutral', text: 'Return unavailable — not enough history for this period.' });
  } else if (ret >= 20) {
    out.push({ type: 'good', text: `Strong return of +${ret.toFixed(1)}% on start invested capital.` });
  } else if (ret >= 5) {
    out.push({ type: 'ok', text: `Positive return of +${ret.toFixed(1)}% on start invested capital.` });
  } else if (ret >= 0) {
    out.push({ type: 'ok', text: `Flat return of +${ret.toFixed(1)}% — effectively breakeven.` });
  } else if (ret >= -10) {
    out.push({ type: 'warning', text: `Slight investment loss of ${ret.toFixed(1)}% based on P/L change.` });
  } else if (ret >= -50) {
    out.push({ type: 'danger', text: `Significant investment loss of ${ret.toFixed(1)}% based on P/L change.` });
  } else {
    out.push({ type: 'danger', text: `Severe return of ${ret.toFixed(1)}% — review position sizing and risk.` });
  }

  if (dd == null) {
    out.push({ type: 'good', text: 'No drawdown in this period — the portfolio never fell from a prior peak.' });
  } else if (dd < 5) {
    out.push({
      type: 'good',
      text: `Max drawdown of just ${dd.toFixed(1)}% — very stable with minimal peak-to-trough exposure.`,
    });
  } else if (dd < 15) {
    out.push({ type: 'ok', text: `Drawdown of ${dd.toFixed(1)}% — within normal range for a diversified equity portfolio.` });
  } else if (dd < 30) {
    out.push({
      type: 'warning',
      text: `Notable drawdown of ${dd.toFixed(1)}% — consider whether your risk allocation matches your tolerance.`,
    });
  } else {
    out.push({
      type: 'danger',
      text: `Severe drawdown of ${dd.toFixed(1)}% — this is a large peak-to-trough decline. High concentration or leverage risk.`,
    });
  }

  if (sr == null) {
    out.push({ type: 'neutral', text: 'Sharpe ratio requires ≥30 data points — extend the period or wait for more snapshots.' });
  } else if (sr >= 1) {
    out.push({
      type: 'good',
      text: `Sharpe of ${sr.toFixed(2)} — solid risk-adjusted return. You're being compensated for the volatility you're taking on.`,
    });
  } else if (sr >= 0.5) {
    out.push({
      type: 'ok',
      text: `Sharpe of ${sr.toFixed(2)} — acceptable, though there's room to improve the return-to-risk ratio.`,
    });
  } else if (sr >= 0) {
    out.push({
      type: 'warning',
      text: `Sharpe of ${sr.toFixed(2)} — barely above the risk-free rate (4.5%/yr). The volatility you're taking isn't paying off much.`,
    });
  } else if (sr >= -1) {
    out.push({
      type: 'danger',
      text: `Sharpe of ${sr.toFixed(2)} — you're earning less than a Selic/fixed-income account while taking on more risk.`,
    });
  } else {
    out.push({
      type: 'danger',
      text: `Sharpe of ${sr.toFixed(2)} — deeply negative. Significant return drag relative to the risk being taken.`,
    });
  }

  if (ret != null && ret < -10 && dd != null && dd < 10 && sr != null && sr < 0) {
    out.push({
      type: 'warning',
      text: 'Note: small max drawdown alongside negative return suggests a slow, steady decline rather than a single crash event.',
    });
  }

  return out;
});

const theme = computed(() => {
  const danger = signals.value.filter((s) => s.type === 'danger').length;
  const warning = signals.value.filter((s) => s.type === 'warning').length;
  const good = signals.value.filter((s) => s.type === 'good' || s.type === 'ok').length;

  if (danger >= 2) return THEMES.danger;
  if (danger === 1 || warning >= 2) return THEMES.warning;
  if (good >= 2) return THEMES.good;
  return THEMES.neutral;
});
</script>

<template>
  <div class="analysis-card" :style="{ borderLeftColor: theme.border }">
    <div class="analysis-header">
      <span class="analysis-icon">{{ theme.icon }}</span>
      <span class="analysis-title">Portfolio Analysis</span>
      <span
        class="analysis-badge"
        :style="{ background: theme.badgeBg, color: theme.color, border: `1px solid ${theme.badgeBorder}` }"
        >{{ theme.badge }}</span
      >
    </div>
    <div class="analysis-signals">
      <div v-for="(signal, i) in signals" :key="i" class="analysis-signal">
        <div class="signal-dot" :style="{ background: DOT_COLORS[signal.type] }"></div>
        <span>{{ signal.text }}</span>
      </div>
    </div>
  </div>
</template>
