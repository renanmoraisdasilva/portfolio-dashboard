<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { createChart, CrosshairMode, LineStyle, type CandlestickData, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { useDashboardStore } from '../../stores/dashboard';

const store = useDashboardStore();

const el = ref<HTMLDivElement | null>(null);
const chart = shallowRef<IChartApi | null>(null);
const candleSeries = shallowRef<ISeriesApi<'Candlestick'> | null>(null);
const projectionSeries = shallowRef<ISeriesApi<'Line'> | null>(null);
let resizeObserver: ResizeObserver | null = null;

function build(): void {
  const container = el.value;
  if (!container) return;

  chart.value = createChart(container, {
    width: container.clientWidth || 800,
    height: container.clientHeight || 320,
    layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
    grid: {
      vertLines: { color: 'rgba(45,55,72,0.5)' },
      horzLines: { color: 'rgba(45,55,72,0.5)' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(45,55,72,0.5)' },
    timeScale: {
      borderColor: 'rgba(45,55,72,0.5)',
      timeVisible: true,
      secondsVisible: false,
      barSpacing: 8,
      minBarSpacing: 4,
      fixRightEdge: true,
      rightOffset: 5,
    },
  });

  candleSeries.value = chart.value.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  projectionSeries.value = chart.value.addLineSeries({
    color: 'rgba(0, 217, 255, 0.85)',
    // lightweight-charts v4 types line width as 1|2|3|4; the vanilla page asked
    // for 1.8, which the same library would have rounded internally anyway.
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    visible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: true,
  });

  resizeObserver = new ResizeObserver(() => {
    if (chart.value && el.value) chart.value.applyOptions({ width: el.value.clientWidth });
  });
  resizeObserver.observe(container);
}

function destroy(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart.value?.remove();
  chart.value = null;
  candleSeries.value = null;
  projectionSeries.value = null;
}

function sync(): void {
  const candles: CandlestickData<UTCTimestamp>[] = store.valueCandles.map((c) => ({
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  candleSeries.value?.setData(candles);

  // The projection only makes sense against portfolio value, never against P/L.
  if (store.projectionEnabled && store.activeMetric === 'value') {
    const line: Array<{ time: UTCTimestamp; value: number }> = store.projection.map((p: { ts: number; v: number }) => ({
      time: Math.floor(p.ts / 1000) as UTCTimestamp,
      value: p.v,
    }));
    projectionSeries.value?.setData(line);
    projectionSeries.value?.applyOptions({ visible: true });
  } else {
    projectionSeries.value?.setData([]);
    projectionSeries.value?.applyOptions({ visible: false });
  }
  chart.value?.timeScale().fitContent();
}

onMounted(() => {
  build();
  sync();
});

watch(
  () => [store.valueCandles, store.projection, store.activeMetric, store.projectionEnabled],
  sync,
  { deep: true },
);

onBeforeUnmount(destroy);
</script>

<template>
  <div ref="el" style="width: 100%; height: 100%"></div>
</template>
