<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore } from '../../stores/dashboard';

const store = useDashboardStore();
const m = computed(() => store.metrics);

function brlOf(usdValue: number): string {
  return store.brlUsdRate > 0 ? store.brl(usdValue / store.brlUsdRate) : '';
}
</script>

<template>
  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Current Value</div>
      <div class="metric-value">
        {{ store.usd(m.total) }}<br />
        <span class="metric-sub-line">{{ brlOf(m.total) }}</span>
      </div>
      <div v-if="m.breakEven" class="metric-change neutral">Break even</div>
      <div v-else class="metric-change" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.unrealized) }} ({{ m.unrealizedPct.toFixed(2) }}%)
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Total Invested</div>
      <div class="metric-value">
        {{ store.usd(m.invested) }}<br />
        <span class="metric-sub-line">{{ brlOf(m.invested) }}</span>
      </div>
      <div class="metric-change neutral">{{ m.investedShareOfTotal.toFixed(2) }}% of current value</div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Total Deposits</div>
      <div class="metric-value">
        {{ store.usd(m.investedNet) }}<br />
        <span class="metric-sub-line">{{ brlOf(m.investedNet) }}</span>
      </div>
      <div class="metric-change neutral">Net invested</div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Unrealized P/L</div>
      <div class="metric-value" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.unrealized) }}<br />
        <span class="metric-sub-line">{{ brlOf(m.unrealized) }}</span>
      </div>
      <div class="metric-change" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ m.unrealized >= 0 ? '+' : '' }}{{ m.unrealizedPct.toFixed(2) }}%
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Realized P/L</div>
      <div class="metric-value" :class="m.realized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.realized) }}<br />
        <span class="metric-sub-line">{{ brlOf(m.realized) }}</span>
      </div>
      <div class="metric-change" :class="m.realized >= 0 ? 'positive' : 'negative'">
        {{ m.realized >= 0 ? '+' : '' }}${{ ((m.realized / Math.max(1, m.invested)) * 100).toFixed(2) }}% from
        {{ m.salesCount }} sales + interest
      </div>
    </div>
  </div>
</template>

<style scoped>
.metric-sub-line {
  font-size: 10px;
  color: #64748b;
  margin-top: -5px;
  display: block;
}
</style>
