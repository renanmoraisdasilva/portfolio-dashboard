<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useApi } from '../../composables/useApi';
import { useDashboardStore, CHART_DAY_RANGES, type OhlcCandle } from '../../stores/dashboard';
import AssetChartCard from './AssetChartCard.vue';

const store = useDashboardStore();
const api = useApi();

const candles = ref<Record<string, OhlcCandle[]>>({});

/** Tradable assets, plus BRL as a frontend alias for the BRLUSD pair. */
const assets = computed(() =>
  store.currencySymbols.includes('BRLUSD') ? [...store.tradeableSymbols, 'BRL'] : store.tradeableSymbols,
);

const rangeTitle = computed(
  () => CHART_DAY_RANGES.find((r) => r.days === store.selectedDays)?.title ?? `${store.selectedDays} Days`,
);

/**
 * Candles from `/api/asset/:symbol/ohlc`, falling back to the rolling price
 * cache for tickers the server has no OHLC for yet — the only path that renders
 * anything for a freshly added symbol.
 */
async function load(symbol: string): Promise<OhlcCandle[]> {
  const days = store.selectedDays;
  const backendSymbol = symbol === 'BRL' ? 'BRLUSD' : symbol;

  const { data } = await api.GET('/asset/{symbol}/ohlc', {
    params: { path: { symbol: backendSymbol }, query: { days } },
  });
  if (Array.isArray(data) && data.length > 0) return data;

  const { data: rolling } = await api.GET('/asset/{symbol}/history', {
    params: { path: { symbol: backendSymbol }, query: { days } },
  });
  const prices = rolling?.prices ?? [];
  if (prices.length === 0) return [];

  const nowMs = Date.now();
  const stepMs = (days * 24 * 60 * 60 * 1000) / Math.max(prices.length, 1);
  const fallback: OhlcCandle[] = [];
  prices.forEach((p, i) => {
    if (typeof p !== 'number') return;
    fallback.push({ ts: nowMs - (prices.length - 1 - i) * stepMs, open: p, high: p, low: p, close: p });
  });
  return fallback;
}

async function loadAll(): Promise<void> {
  const next: Record<string, OhlcCandle[]> = {};
  for (const symbol of assets.value) {
    next[symbol] = await load(symbol);
  }
  candles.value = next;
}

watch(assets, loadAll, { immediate: true });
watch(() => store.selectedDays, loadAll);
</script>

<template>
  <div>
    <div class="card-header">
      <div class="card-title">
        <span class="card-icon">📊</span>Asset Price Charts (Last {{ rangeTitle }})
      </div>
      <div class="chart-controls">
        <button
          v-for="range in CHART_DAY_RANGES"
          :key="range.days"
          class="chip"
          :class="{ active: store.selectedDays === range.days }"
          :data-days="range.days"
          @click="store.setChartDays(range.days)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <div class="asset-grid">
      <AssetChartCard v-for="symbol in assets" :key="symbol" :symbol="symbol" :candles="candles[symbol] ?? []" />
    </div>
  </div>
</template>
