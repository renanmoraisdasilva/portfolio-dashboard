<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  createChart,
  CrosshairMode,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { formatMoney } from '@portfolio-dashboard/shared';
import type { OhlcCandle } from '../../stores/dashboard';
import { useDashboardStore } from '../../stores/dashboard';

const props = defineProps<{ symbol: string; candles: OhlcCandle[] }>();

const store = useDashboardStore();

const el = ref<HTMLDivElement | null>(null);
const chart = shallowRef<IChartApi | null>(null);
const series = shallowRef<ISeriesApi<'Candlestick'> | null>(null);
let resizeObserver: ResizeObserver | null = null;

const isAlias = computed(() => props.symbol === 'BRL');
const isBond = computed(() => !isAlias.value && store.symbolDetails[props.symbol]?.type === 'bond');

const priceText = computed(() => {
  const current = isAlias.value ? (store.brlUsdRate ? 1 / store.brlUsdRate : null) : (store.prices[props.symbol] ?? null);
  if (typeof current !== 'number' || isNaN(current)) return '';

  const meta = store.priceMeta[props.symbol];
  if (isAlias.value) return `R$${current.toFixed(4)}`;
  if (isBond.value) {
    const priceBRL = typeof meta?.priceBRL === 'number' ? meta.priceBRL : store.brlUsdRate ? current / store.brlUsdRate : null;
    const text = `R$${(priceBRL ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return typeof meta?.taxaCompra === 'number' ? `${text} IPCA+${meta.taxaCompra.toFixed(2)}%` : text;
  }
  if (store.isBRLNonBond(props.symbol)) {
    return `R$${current.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatMoney(current, 'USD');
});

const change = computed(() => {
  const first = props.candles.find((c) => (c.open ?? 0) > 0);
  const last = [...props.candles].reverse().find((c) => (c.close ?? 0) > 0);
  if (!first || !last || (first.open ?? 0) === 0) return null;
  const pct = (((last.close ?? 0) - (first.open ?? 0)) / (first.open ?? 1)) * 100;
  return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`, positive: pct >= 0 };
});

function destroy(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  chart.value?.remove();
  chart.value = null;
  series.value = null;
}

function build(): void {
  const container = el.value;
  if (!container) return;

  chart.value = createChart(container, {
    width: container.clientWidth || 280,
    height: 240,
    layout: { background: { color: 'transparent' }, textColor: '#94a3b8' },
    grid: {
      vertLines: { color: 'rgba(45,55,72,0.5)' },
      horzLines: { color: 'rgba(45,55,72,0.5)' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(45,55,72,0.5)' },
    timeScale: {
      borderColor: 'rgba(45,55,72,0.5)',
      timeVisible: store.selectedDays <= 7,
      secondsVisible: false,
      fixRightEdge: true,
      rightOffset: 2,
    },
  });

  series.value = chart.value.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderUpColor: '#22c55e',
    borderDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
  });

  resizeObserver = new ResizeObserver(() => {
    if (chart.value && el.value && el.value.clientWidth > 0) {
      chart.value.applyOptions({ width: el.value.clientWidth });
    }
  });
  resizeObserver.observe(container);
}

function sync(): void {
  if (!series.value) return;
  const data: CandlestickData<UTCTimestamp>[] = props.candles
    .map((c) => ({
      time: Math.floor((c.ts ?? 0) / 1000) as UTCTimestamp,
      open: c.open ?? 0,
      high: c.high ?? 0,
      low: c.low ?? 0,
      close: c.close ?? 0,
    }))
    .filter((c) => c.open > 0);
  series.value.setData(data);
  if (data.length > 0) chart.value?.timeScale().fitContent();
}

onMounted(() => {
  build();
  sync();
});

watch(() => props.candles, sync, { deep: true });
watch(
  () => store.selectedDays,
  () => chart.value?.applyOptions({ timeScale: { timeVisible: store.selectedDays <= 7 } }),
);

onBeforeUnmount(destroy);
</script>

<template>
  <div class="asset-chart-card">
    <b>
      {{ symbol }}
      <span v-if="priceText" style="margin-left: 8px; color: #94a3b8; font-weight: 600; font-size: 14px">{{ priceText }}</span>
      <span v-if="change" :class="change.positive ? 'positive' : 'negative'" style="margin-left: 8px">{{ change.text }}</span>
    </b>
    <div ref="el" style="flex: 1; width: 100%"></div>
  </div>
</template>

<style scoped>
.asset-chart-card {
  text-align: center;
  height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
}
</style>
