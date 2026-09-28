<script setup lang="ts">
import { computed } from 'vue';
import type { ChartConfiguration } from 'chart.js';
import ChartCanvas from '../ChartCanvas.vue';
import { useDashboardStore } from '../../stores/dashboard';

const store = useDashboardStore();

const config = computed<ChartConfiguration<'bar'> | null>(() => {
  if (store.plByAsset.labels.length === 0) return null;
  return {
    type: 'bar',
    data: {
      labels: store.plByAsset.labels,
      datasets: [
        {
          label: 'Unrealized P/L',
          data: store.plByAsset.values,
          backgroundColor: store.plByAsset.colors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: '#94a3b8' }, grid: { color: '#2d3748' } },
        x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
      },
    },
  } as ChartConfiguration<'bar'>;
});
</script>

<template>
  <ChartCanvas :config="config" empty-message="No open positions yet." />
</template>
