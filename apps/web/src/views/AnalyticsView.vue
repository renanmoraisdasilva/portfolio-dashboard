<script setup lang="ts">
import { computed, onMounted } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import MetricCard from '../components/MetricCard.vue';
import ChartCanvas from '../components/ChartCanvas.vue';
import AllocationTable from '../components/AllocationTable.vue';
import OverallAnalysisCard from '../components/analysis/OverallAnalysisCard.vue';
import CashDragCard from '../components/analysis/CashDragCard.vue';
import RiskProfileCard from '../components/analysis/RiskProfileCard.vue';
import { CASH_CHART_MODE, PERIODS, useAnalyticsStore } from '../stores/analytics';
import { useAnalyticsCharts } from '../composables/useAnalyticsCharts';
import { useAnalyticsTooltips } from '../composables/useAnalyticsTooltips';
import { daysBetween, fmtDate, fmtPct } from '../composables/useMoney';
import { useDocumentTitle } from '../composables/useDocumentTitle';

import '../../../../static/css/analytics.css';

const store = useAnalyticsStore();
const { cashAssets, portfolioConfig, costMarketConfig } = useAnalyticsCharts();
const { returnTooltip, drawdownTooltip, sharpeTooltip } = useAnalyticsTooltips();

useDocumentTitle('Analytics Lab');

onMounted(async () => {
  await store.load();
  await store.selectPeriod(store.period);
});

const snap = computed(() => store.active);
const returnPct = computed(() => snap.value?.return_pct ?? null);
const drawdownPct = computed(() => snap.value?.max_drawdown_pct ?? null);
const sharpe = computed(() => snap.value?.sharpe_ratio ?? null);
const lastComputed = computed(() => (snap.value?.computed_at ? new Date(snap.value.computed_at).toLocaleString() : '—'));

const drawdownSub = computed(() => {
  if (drawdownPct.value == null) return 'No drawdown in period';
  const start = snap.value?.max_drawdown_start ?? null;
  const end = snap.value?.max_drawdown_end ?? null;
  if (!start || !end) return '—';
  const days = daysBetween(start, end);
  return `${fmtDate(start)} → ${fmtDate(end)} · ${days} day${days !== 1 ? 's' : ''}`;
});

const drawdownMarker = computed(() => (drawdownPct.value != null ? `Max DD −${drawdownPct.value.toFixed(1)}%` : ''));

const sharpeColor = computed(() =>
  sharpe.value == null
    ? undefined
    : sharpe.value >= 1
      ? 'var(--accent-success)'
      : sharpe.value >= 0.5
        ? 'var(--accent-warning)'
        : 'var(--accent-danger)',
);

const muted = { color: 'var(--text-muted)' } as Record<string, string>;
</script>

<template>
  <div class="analytics-page">
    <PageHeader title="Analytics Lab" subtitle="Performance metrics & portfolio analytics" />

    <div class="status-bar">
      <div class="status-dot" :class="store.online ? 'online' : 'offline'"></div>
      <span class="last-computed"
        >Last computed: <strong>{{ lastComputed }}</strong></span
      >
      <span class="spacer"></span>
      <span style="color: var(--text-muted); font-size: 13px">Updates every 24 h</span>
    </div>

    <div class="period-tabs">
      <button
        v-for="p in PERIODS"
        :key="p.id"
        class="period-tab"
        :class="{ active: store.period === p.id }"
        @click="store.selectPeriod(p.id)"
      >
        {{ p.id }}
      </button>
    </div>

    <div class="metrics-grid">
      <MetricCard
        icon="📈"
        label="Return"
        :value="fmtPct(returnPct)"
        :value-class="returnPct == null ? '' : returnPct >= 0 ? 'positive' : 'negative'"
        :sub="returnPct == null ? 'Not enough history' : `${returnPct >= 0 ? '↑' : '↓'} P/L return over period`"
        :sub-class="returnPct == null ? '' : returnPct >= 0 ? 'positive' : 'negative'"
        :tooltip="returnTooltip(snap)"
      />

      <MetricCard
        icon="📉"
        label="Max Drawdown"
        variant="danger"
        :value="drawdownPct == null ? '—' : `−${drawdownPct.toFixed(1)}%`"
        :value-style="muted"
        :sub="drawdownSub"
        :sub-style="muted"
        :tooltip="drawdownTooltip(snap)"
      />

      <MetricCard
        icon="⚖️"
        label="Sharpe Ratio"
        variant="neutral-accent"
        :value="sharpe == null ? 'N/A' : sharpe.toFixed(2)"
        :value-is-badge="sharpe == null"
        :value-style="sharpeColor ? { color: sharpeColor } : undefined"
        :sub="sharpe == null ? '< 30 data points — not enough history' : 'Risk-free: 4.5% / yr · ≥30 pts'"
        :sub-style="muted"
        :tooltip="sharpeTooltip(snap)"
      />
    </div>

    <OverallAnalysisCard :snap="snap" />

    <CashDragCard />

    <div class="charts-grid" style="margin-bottom: 16px">
      <div class="chart-card">
        <div class="chart-card-header">
          <div class="chart-card-title">
            <div class="chart-card-icon">🏦</div>
            Cash vs Assets Over Time
          </div>
          <div class="cash-assets-controls">
            <div class="currency-toggle" role="group" aria-label="Cash chart currency">
              <button
                type="button"
                class="currency-toggle-btn"
                :class="{ active: store.cashChartMode === CASH_CHART_MODE.ASSETS_CASH }"
                @click="store.setCashChartMode(CASH_CHART_MODE.ASSETS_CASH)"
              >
                Assets vs Cash
              </button>
              <button
                type="button"
                class="currency-toggle-btn"
                :class="{ active: store.cashChartMode === CASH_CHART_MODE.CASH_CURRENCIES }"
                @click="store.setCashChartMode(CASH_CHART_MODE.CASH_CURRENCIES)"
              >
                BRL vs USD
              </button>
            </div>
            <span class="cash-assets-meta">{{ cashAssets ? cashAssets.meta : 'period history · assets vs cash (USD)' }}</span>
          </div>
        </div>
        <ChartCanvas :config="cashAssets?.config ?? null" empty-message="No history data for this period" />
      </div>

      <RiskProfileCard />
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card-header">
          <div class="chart-card-title">
            <div class="chart-card-icon">📈</div>
            Portfolio Value
          </div>
          <span class="drawdown-marker">{{ drawdownMarker }}</span>
        </div>
        <ChartCanvas :config="portfolioConfig" empty-message="No history data for this period" />
      </div>

      <div class="chart-card">
        <div class="chart-card-header">
          <div class="chart-card-title">
            <div class="chart-card-icon">💹</div>
            Cost Basis vs Market Value
          </div>
          <span style="font-size: 13px; color: var(--text-muted)">at period end</span>
        </div>
        <ChartCanvas :config="costMarketConfig" empty-message="No position data available" />
      </div>
    </div>

    <div class="chart-card" style="margin-bottom: 16px">
      <div class="chart-card-header">
        <div class="chart-card-title">
          <div class="chart-card-icon">🥧</div>
          Allocation &amp; P/L at Period End
        </div>
        <span style="font-size: 13px; color: var(--text-muted)"> Replayed from trades · prices at snapshot time </span>
      </div>

      <AllocationTable />
    </div>
  </div>
</template>
