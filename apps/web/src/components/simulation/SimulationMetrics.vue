<script setup lang="ts">
import { computed } from 'vue';
import { useSimulationStore } from '../../stores/simulation';

const store = useSimulationStore();
const m = computed(() => store.metrics);
const rate = computed(() => store.brlUsdRate || 0);
</script>

<template>
  <div class="metrics-grid">
    <div class="metric-card">
      <div class="metric-label">Current Value</div>
      <div class="metric-value">
        {{ store.usd(m.totalValue) }}<br />
        <span v-if="m.brlTotal !== null" class="metric-sub">{{ store.brl(m.brlTotal) }}</span>
      </div>
      <div v-if="m.breakEven" class="metric-change neutral">Break even</div>
      <div v-else class="metric-change" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.unrealized) }} ({{ m.unrealPct.toFixed(2) }}%)
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Total Invested</div>
      <div class="metric-value">
        {{ store.usd(m.tickerValue) }}<br />
        <span v-if="rate" class="metric-sub">{{ store.brl(m.tickerValue / rate) }}</span>
      </div>
      <div class="metric-change neutral">{{ m.investedPct.toFixed(2) }}% invested</div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Total Deposits</div>
      <div class="metric-value">
        {{ store.usd(m.investedNet) }}<br />
        <span v-if="m.brlInvested !== null" class="metric-sub">{{ store.brl(m.brlInvested) }}</span>
      </div>
      <div class="metric-change neutral">Net invested</div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Unrealized P/L</div>
      <div class="metric-value" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.unrealized) }}<br />
        <span v-if="m.brlUnrealized !== null" class="metric-sub">{{ store.brl(m.brlUnrealized) }}</span>
      </div>
      <div class="metric-change" :class="m.unrealized >= 0 ? 'positive' : 'negative'">
        {{ m.unrealized >= 0 ? '+' : '' }}{{ m.unrealPct.toFixed(2) }}%
      </div>
    </div>

    <div class="metric-card">
      <div class="metric-label">Realized P/L</div>
      <div class="metric-value" :class="m.realized >= 0 ? 'positive' : 'negative'">
        {{ store.signedUsd(m.realized) }}<br />
        <span v-if="m.brlRealized !== null" class="metric-sub">{{ store.brl(m.brlRealized) }}</span>
      </div>
      <div class="metric-change neutral">
        {{ m.realized >= 0 ? '+' : '' }}${{ m.realizedPctOfInvested.toFixed(2) }}% from {{ m.salesCount }} sales
      </div>
    </div>
  </div>
</template>
