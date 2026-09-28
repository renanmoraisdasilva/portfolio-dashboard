<script setup lang="ts">
import { computed } from 'vue';
import { computeRiskProfile } from '@portfolio-dashboard/shared';
import { useAnalyticsStore } from '../../stores/analytics';

/**
 * Portfolio Risk Profile.
 *
 * The score itself is `computeRiskProfile` from `packages/shared` — this
 * component only feeds it the current numbers and renders the breakdown.
 */
const store = useAnalyticsStore();

const view = computed(() => {
  const snap = store.active;
  if (!snap) return null;

  const profile = computeRiskProfile({
    drawdownPct: Number(snap.max_drawdown_pct || 0),
    sharpeRatio: Number(snap.sharpe_ratio || 0),
    cashPct: store.cashPct,
    deployableCashPct: store.deployableCashPct,
    emergencyCoverage: store.emergencyCoverage,
    maxAssetAllocPct: store.maxAssetAllocPct,
    periodReturnPct: Number(snap.return_pct || 0),
    pnlStdPct: store.pnlStdPct,
  });

  let badgeClass = 'analysis-badge safe';
  if (profile.score >= 55) badgeClass = 'analysis-badge danger';
  else if (profile.score >= 35) badgeClass = 'analysis-badge warn';

  return {
    profile,
    badgeClass,
    badge: `${profile.label} Risk · ${profile.score.toFixed(0)}/100`,
    sharpeText: snap.sharpe_ratio == null ? 'N/A' : Number(snap.sharpe_ratio).toFixed(2),
    drawdownText: Number(snap.max_drawdown_pct || 0).toFixed(1),
    deployableCashPct: store.deployableCashPct,
    emergencyCoveragePct: store.emergencyCoverage * 100,
    maxAllocPct: store.maxAssetAllocPct,
    pnlStdPct: store.pnlStdPct,
  };
});
</script>

<template>
  <div class="chart-card" id="riskProfileCard">
    <div class="chart-card-header">
      <div class="chart-card-title">
        <div class="chart-card-icon">🧭</div>
        Portfolio Risk Profile
      </div>
      <span :class="view ? view.badgeClass : 'analysis-badge'">{{ view ? view.badge : 'Unavailable' }}</span>
    </div>

    <div class="analysis-signals" style="margin-top: 6px">
      <template v-if="view">
        <div class="risk-bar-wrap">
          <div class="risk-bar-bg">
            <div class="risk-bar-fill" :style="{ width: `${view.profile.score.toFixed(1)}%` }"></div>
          </div>
        </div>
        <div class="analysis-signal">
          <div class="signal-dot" style="background: #38bdf8"></div>
          <span
            ><strong>Main risk drivers:</strong> Sharpe {{ view.sharpeText }}
            ({{ view.profile.components.sharpeRisk.toFixed(1) }} pts), drawdown
            {{ view.drawdownText }}% ({{ view.profile.components.ddRisk.toFixed(1) }} pts), concentration
            {{ view.maxAllocPct.toFixed(1) }}%
            ({{ view.profile.components.concentrationRisk.toFixed(1) }} pts).</span
          >
        </div>
        <div class="analysis-signal">
          <div class="signal-dot" style="background: #94a3b8"></div>
          <span
            ><strong>Cash posture:</strong> deployable cash {{ view.deployableCashPct.toFixed(1) }}%
            (+{{ view.profile.components.deployableCashRisk.toFixed(1) }} pts), emergency coverage
            {{ view.emergencyCoveragePct.toFixed(1) }}%
            (−{{ view.profile.components.cashBufferCredit.toFixed(1) }} pts).</span
          >
        </div>
        <div v-if="view.profile.components.emergencyShortfallRisk > 0" class="analysis-signal">
          <div class="signal-dot" style="background: #ef4444"></div>
          <span
            ><strong>Alert:</strong> emergency shortfall adds
            +{{ view.profile.components.emergencyShortfallRisk.toFixed(1) }} pts to risk.</span
          >
        </div>
        <div class="analysis-signal">
          <div class="signal-dot" style="background: #64748b"></div>
          <span
            ><strong>Volatility context:</strong> short-term P/L volatility is
            {{ view.pnlStdPct.toFixed(3) }}% per step (+{{ view.profile.components.volRisk.toFixed(1) }}
            pts).</span
          >
        </div>
      </template>

      <div v-else class="analysis-signal">
        <div class="signal-dot" style="background: #64748b"></div>
        <span>Could not compute risk profile.</span>
      </div>
    </div>
  </div>
</template>
