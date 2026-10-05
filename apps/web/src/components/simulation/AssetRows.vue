<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney } from '@portfolio-dashboard/shared';
import { useSimulationStore } from '../../stores/simulation';
import AssetIcon from './AssetIcon.vue';
import { sliderBackground } from './slider';

const store = useSimulationStore();

const rows = computed(() => store.assetList);

const brlRow = computed(() => {
  const pct = Number(store.simPricePcts['BRLUSD']) || 0;
  const shown = (v: number): string => (v ? formatMoney(v, 'BRL') : '');
  return { pct, text: shown(store.brlPerUsd), baseText: shown(store.baseBrlPerUsd) };
});

function onSlider(symbol: string, event: Event): void {
  store.setPricePct(symbol, Number((event.target as HTMLInputElement).value) || 0);
  if (store.symbol === symbol) store.syncPriceToSymbol();
}

function onPrice(symbol: string, event: Event): void {
  store.setPrice(symbol, (event.target as HTMLInputElement).value);
  if (store.symbol === symbol) store.syncPriceToSymbol();
}

function onBrlSlider(event: Event): void {
  store.setBrlPct(Number((event.target as HTMLInputElement).value) || 0);
}

function onBrlInput(event: Event): void {
  store.setBrlPerUsd((event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="asset-rows">
    <div v-for="s in rows" :key="s" class="asset-row">
      <div class="asset-icon"><AssetIcon :symbol="s" /></div>
      <label>{{ s }}</label>
      <input
        class="asset-price sim-input"
        type="text"
        :data-asset="s"
        :value="store.displayPriceText(s)"
        @change="onPrice(s, $event)"
      />
      <div style="display: flex; align-items: center; gap: 8px">
        <input
          class="sim-slider"
          type="range"
          min="-100"
          max="300"
          step="1"
          :value="Number(store.simPricePcts[s]) || 0"
          :style="{ background: sliderBackground(-100, 300, Number(store.simPricePcts[s]) || 0) }"
          @input="onSlider(s, $event)"
        />
        <div class="small">{{ store.displayPctText(s) }}</div>
      </div>
      <div style="justify-self: end" class="asset-current">
        Current: <span>{{ store.displayBaseText(s) }}</span>
      </div>
    </div>

    <div class="asset-row">
      <div class="asset-icon"><AssetIcon symbol="BRL" /></div>
      <label>BRL per USD</label>
      <input class="asset-price sim-input" data-asset="BRLUSD" type="text" :value="brlRow.text" @change="onBrlInput" />
      <div style="display: flex; align-items: center; gap: 8px">
        <input
          class="sim-slider"
          type="range"
          min="-50"
          max="50"
          step="1"
          :value="brlRow.pct"
          :style="{ background: sliderBackground(-50, 50, brlRow.pct) }"
          @input="onBrlSlider"
        />
        <div class="small">{{ brlRow.pct >= 0 ? '+' : '' }}{{ brlRow.pct }}%</div>
      </div>
      <div style="justify-self: end" class="asset-current">
        Current: <span>{{ brlRow.baseText }}</span>
      </div>
    </div>
  </div>
</template>
