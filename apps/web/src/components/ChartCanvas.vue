<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';

const props = defineProps<{
  config: ChartConfiguration<'line'> | ChartConfiguration<'bar'> | null;
  emptyMessage: string;
}>();

const canvas = ref<HTMLCanvasElement | null>(null);
const chart = shallowRef<Chart | null>(null);

function render(): void {
  chart.value?.destroy();
  chart.value = null;
  if (!canvas.value || !props.config) return;
  chart.value = new Chart(canvas.value.getContext('2d')!, props.config as ChartConfiguration);
}

onMounted(render);
watch(() => props.config, render, { flush: 'post' });
onBeforeUnmount(() => chart.value?.destroy());
</script>

<template>
  <div class="chart-container tall">
    <canvas ref="canvas"></canvas>
    <p v-if="!config" class="chart-empty">{{ emptyMessage }}</p>
  </div>
</template>

<style scoped>
.chart-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: #475569;
  font-size: 14px;
  pointer-events: none;
}
</style>
