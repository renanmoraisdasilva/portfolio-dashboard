<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
// `chart.js/auto` registers the scale/category controllers. The bare `chart.js`
// entry does not, and fails at runtime with `"category" is not a registered
// scale` — the CDN build the legacy page loaded was the auto one.
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';

/**
 * Chart.js lifecycle in one place.
 *
 * The legacy page kept six module-level `let chart` variables and called
 * `destroy()` before each redraw; here the config is a prop and this component
 * owns create/destroy, so a chart can never leak when the period changes.
 */
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
