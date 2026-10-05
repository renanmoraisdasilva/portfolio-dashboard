<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import { useDashboardStore } from '../../stores/dashboard';
import { dashboardPieLabelPlugin } from './pieLabelPlugin';

const store = useDashboardStore();

const el = ref<HTMLCanvasElement | null>(null);
const chart = shallowRef<Chart | null>(null);

const config = computed<ChartConfiguration<'doughnut'>>(() => ({
  type: 'doughnut',
  data: {
    labels: store.allocation.labels,
    datasets: [
      {
        data: store.allocation.pcts,
        backgroundColor: store.allocation.colors,
        borderColor: '#0a0e1a',
        borderWidth: 2,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '48%',
    layout: { padding: { top: 8, right: 8, bottom: 8, left: 8 } },
    plugins: {
      legend: { display: false },
      pieLabelPlugin: {
        threshold: 5,
        textColor: '#fff',
        nameFont: 'bold 12px system-ui, sans-serif',
        pctFont: '11px system-ui, sans-serif',
      },
    },
  },
  plugins: [dashboardPieLabelPlugin],
}));

function render(): void {
  chart.value?.destroy();
  chart.value = null;
  if (!el.value) return;
  chart.value = new Chart(el.value.getContext('2d')!, config.value);
}

onMounted(render);
watch(
  config,
  (next) => {
    if (!chart.value) return;
    chart.value.data.labels = next.data?.labels ?? [];
    chart.value.data.datasets = next.data?.datasets ?? [];
    chart.value.update();
    chart.value.resize();
  },
  { deep: true },
);
onBeforeUnmount(() => chart.value?.destroy());

const rows = computed(() =>
  store.allocation.labels.map((label, i) => {
    const usdValue = store.allocation.values[i] || 0;
    const display =
      store.allocCurrency === 'USD'
        ? `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : `R$ ${((store.brlUsdRate || 0) > 0 ? usdValue / store.brlUsdRate : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return { label, color: store.allocation.colors[i], value: display };
  }),
);
</script>

<template>
  <div class="chart-container alloc">
    <div class="alloc-wrap">
      <div class="alloc-chart">
        <div
          class="currency-toggle top"
          role="tablist"
          aria-label="Allocation currency"
          style="position: absolute; top: 8px; right: 8px; z-index: 2"
        >
          <button class="chip" :class="{ active: store.allocCurrency === 'USD' }" @click="store.setAllocCurrency('USD')">
            USD
          </button>
          <button class="chip" :class="{ active: store.allocCurrency === 'BRL' }" @click="store.setAllocCurrency('BRL')">
            BRL
          </button>
        </div>
        <canvas ref="el"></canvas>
      </div>
      <div class="alloc-summary">
        <div style="width: 100%; margin-top: 8px">
          <div v-if="rows.length === 0" class="empty-state">No allocation yet.</div>
          <div v-for="row in rows" :key="row.label" class="alloc-row">
            <div class="left">
              <div class="swatch" :style="{ background: row.color }"></div>
              <div class="asset-label">{{ row.label }}</div>
            </div>
            <div class="asset-value">{{ row.value }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
