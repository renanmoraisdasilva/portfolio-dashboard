<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import { formatMoney } from '@portfolio-dashboard/shared';
import { useSimulationStore } from '../../stores/simulation';
import { pieLabelPlugin } from './pieLabelPlugin';

const store = useSimulationStore();

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
  plugins: [pieLabelPlugin],
}));

function render(): void {
  chart.value?.destroy();
  chart.value = null;
  if (!el.value) return;
  chart.value = new Chart(el.value.getContext('2d')!, config.value);
}

onMounted(render);
// The chart is constructed before the store finishes loading, so it starts with
// an empty dataset. Assign the fresh slices onto the *live* chart, the way the
// vanilla page did (`chart.data.labels = …; chart.data.datasets = …; update()`):
// a bare `update()` would keep re-rendering the empty snapshot it was built with.
watch(
  config,
  (next) => {
    if (!chart.value) return;
    chart.value.data.labels = next.data?.labels ?? [];
    chart.value.data.datasets = next.data?.datasets ?? [];
    chart.value.update();
  },
  { deep: true },
);
onBeforeUnmount(() => chart.value?.destroy());

/** Side list values honor the USD/BRL toggle; the doughnut always shows shares. */
const rows = computed(() =>
  store.allocation.labels.map((label, i) => {
    const usdValue = store.allocation.values[i] || 0;
    const inBrl = store.simAllocCurrency === 'BRL' && store.brlUsdRate > 0;
    return {
      label,
      color: store.allocation.colors[i],
      value: formatMoney(inBrl ? usdValue / store.brlUsdRate : usdValue, store.simAllocCurrency, 2),
    };
  }),
);
</script>

<template>
  <div class="alloc-wrap">
    <div class="chart-container alloc alloc-chart">
      <canvas ref="el"></canvas>
    </div>
    <div class="alloc-summary">
      <div style="display: flex; align-items: center; gap: 8px; width: 100%; justify-content: space-between">
        <div class="summary-label">Allocation</div>
        <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 10px">
          <button
            class="chip"
            :class="{ active: store.simAllocCurrency === 'USD' }"
            @click="store.simAllocCurrency = 'USD'"
          >
            USD
          </button>
          <button
            class="chip"
            :class="{ active: store.simAllocCurrency === 'BRL' }"
            @click="store.simAllocCurrency = 'BRL'"
          >
            BRL
          </button>
        </div>
      </div>
      <div>
        <div v-for="row in rows" :key="row.label" class="alloc-row">
          <div class="left">
            <div class="swatch" :style="{ background: row.color }"></div>
            <div class="asset-label">{{ row.label }}</div>
          </div>
          <div class="asset-value">{{ row.value }}</div>
        </div>
      </div>
      <p class="small" style="margin-top: 8px">Values shown in {{ store.simAllocCurrency }}</p>
    </div>
  </div>
</template>
