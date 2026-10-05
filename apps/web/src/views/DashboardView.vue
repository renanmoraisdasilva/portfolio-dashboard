<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import PageHeader from '../components/PageHeader.vue';
import { useDashboardStore } from '../stores/dashboard';
import { useDocumentTitle } from '../composables/useDocumentTitle';
import { useToast } from '../composables/useToast';
import AddTradeForm from '../components/dashboard/AddTradeForm.vue';
import AlertsPanel from '../components/dashboard/AlertsPanel.vue';
import AllocationPanel from '../components/dashboard/AllocationPanel.vue';
import AssetChartsSection from '../components/dashboard/AssetChartsSection.vue';
import CashPanel from '../components/dashboard/CashPanel.vue';
import MetricCards from '../components/dashboard/MetricCards.vue';
import PlByAssetChart from '../components/dashboard/PlByAssetChart.vue';
import PositionsTable from '../components/dashboard/PositionsTable.vue';
import TradeHistoryTable from '../components/dashboard/TradeHistoryTable.vue';
import ValueChart from '../components/dashboard/ValueChart.vue';

import '../../../../static/css/dashboard.css';

const store = useDashboardStore();
const { toasts } = useToast();
const route = useRoute();

useDocumentTitle('Portfolio Dashboard');

function tabFromUrl(): 'dashboard' | 'assetCharts' {
  return route.query.tab === 'assetCharts' ? 'assetCharts' : 'dashboard';
}

watch(
  tabFromUrl,
  (tab) => {
    if (store.tab !== tab) store.setTab(tab);
  },
  { immediate: true },
);

const REFRESH_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  await store.load();
  timer = setInterval(async () => {
    await store.refresh();
    await store.loadTriggeredAlerts();
  }, REFRESH_MS);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="dashboard-page">
    <PageHeader title="Holdings" subtitle="Cash, positions, trades and alerts in one view" />

    <template v-if="store.tab === 'dashboard'">
      <div v-if="store.staleWarning" class="banner-warning">⚠️ {{ store.staleWarning }}</div>
      <div v-if="store.priceError" class="banner-error">🚫 {{ store.priceError }}</div>

      <MetricCards />

      <div class="content-grid">
        <div class="card card-chart">
          <div class="card-header">
            <div class="card-title"><span class="card-icon">📈</span>Portfolio Value Over Time</div>
            <div class="chart-controls">
              <div class="chart-group chart-series-group">
                <button class="chip" :class="{ active: store.activeSeries === 'all' }" @click="store.setMetric('all')">
                  All
                </button>
                <button class="chip" :class="{ active: store.activeSeries === 'value' }" @click="store.setMetric('value')">
                  Value
                </button>
                <button class="chip" :class="{ active: store.activeSeries === 'pnl' }" @click="store.setMetric('pnl')">
                  P/L
                </button>
              </div>
              <div class="chart-group chart-projection-group">
                <button
                  class="chip"
                  title="Toggle trend projection"
                  :class="{ active: store.projectionEnabled }"
                  @click="store.toggleProjection()"
                >
                  Projection
                </button>
              </div>
            </div>
          </div>
          <div class="chart-container chart-container-large">
            <ValueChart />
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-icon">🥧</span>Asset Allocation</div>
            <div style="margin-left: auto; display: flex; gap: 6px; align-items: center">
              <div class="alloc-seg" role="tablist" aria-label="Allocation view">
                <button
                  class="alloc-seg-btn"
                  :class="{ active: store.allocationShowCash }"
                  role="tab"
                  @click="store.setAllocationMode('withCash')"
                >
                  With Cash
                </button>
                <button
                  class="alloc-seg-btn"
                  :class="{ active: !store.allocationShowCash }"
                  role="tab"
                  @click="store.setAllocationMode('investments')"
                >
                  Investments
                </button>
              </div>
            </div>
          </div>
          <AllocationPanel />
        </div>
      </div>

      <div class="stats-grid">
        <div class="card">
          <div class="card-header">
            <div class="card-title"><span class="card-icon">💰</span>Profit/Loss by Asset</div>
          </div>
          <PlByAssetChart />
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">➕</span>Add New Trade</div>
        </div>
        <AddTradeForm />
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">💵</span>Cash Positions</div>
        </div>
        <CashPanel />
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">💼</span>Current Positions</div>
        </div>
        <PositionsTable />
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="card-icon">📜</span>Trade History</div>
        </div>
        <TradeHistoryTable />
      </div>

      <AlertsPanel />
    </template>

    <div v-show="store.tab === 'assetCharts'" class="card">
      <AssetChartsSection />
    </div>

    <div class="toast-host">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.kind">{{ toast.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.banner-warning {
  color: #b45309;
  background: #fffbeb;
  padding: 12px;
  font-weight: 600;
  font-size: 1em;
  border-bottom: 1px solid #fbbf24;
}
.banner-error {
  color: #ef4444;
  background: #fff0f0;
  padding: 12px;
  font-weight: 700;
  font-size: 1.1em;
  border-bottom: 2px solid #ef4444;
}
.toast-host {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 50;
}
.toast {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.toast.success {
  background: #14532d;
  color: #dcfce7;
  border: 1px solid #22c55e;
}
.toast.error {
  background: #450a0a;
  color: #fee2e2;
  border: 1px solid #ef4444;
}
</style>
