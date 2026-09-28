<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney, parseMoney } from '@portfolio-dashboard/shared';
import { useSimulationStore, type CashSource, type Side } from '../../stores/simulation';
import { sliderBackground } from './slider';

const store = useSimulationStore();

const cashReaisText = computed(() => formatMoney(store.simCashReais, 'BRL'));
const cashDollarsText = computed(() => formatMoney(store.simCashDollars, 'USD'));

/** Steppers add or remove 1 from the field, then re-derive the total. */
function step(field: 'qty' | 'price', delta: number): void {
  if (field === 'qty') {
    const next = (parseFloat(store.qtyInput) || 0) + delta;
    store.setQty(String(Math.round(next * 1e4) / 1e4));
    return;
  }
  const currency = store.isBRLAsset(store.symbol) ? 'BRL' : 'USD';
  const current = parseMoney(store.priceInput, currency) || 0;
  const next = +(Math.max(0, current + delta)).toFixed(2);
  store.setPriceInput(formatMoney(next, currency));
}

function onCashReais(event: Event): void {
  store.simCashReais = +parseMoney((event.target as HTMLInputElement).value, 'BRL').toFixed(2);
}

function onCashDollars(event: Event): void {
  store.simCashDollars = +parseMoney((event.target as HTMLInputElement).value, 'USD').toFixed(2);
}

function onQtyPct(event: Event): void {
  store.setQtyPct(Number((event.target as HTMLInputElement).value) || 0);
}

function onAssetChange(event: Event): void {
  store.symbol = (event.target as HTMLSelectElement).value;
  store.syncPriceToSymbol();
}

function onTotalChange(event: Event): void {
  store.setTotal((event.target as HTMLInputElement).value);
}

const emit = defineEmits<{
  add: [];
  clear: [];
}>();

function submit(): void {
  const message = store.addTrade();
  if (message) window.alert(message);
  else emit('add');
}

function setSide(side: Side): void {
  store.setSide(side);
}

function setCashSource(source: CashSource): void {
  store.setCashSource(source);
}
</script>

<template>
  <div class="form-grid">
    <div>
      <label class="small">Side</label>
      <div style="display: flex; gap: 8px">
        <button class="chip" :class="{ active: store.side === 'buy' }" type="button" @click="setSide('buy')">Buy</button>
        <button class="chip" :class="{ active: store.side === 'sell' }" type="button" @click="setSide('sell')">Sell</button>
      </div>
    </div>

    <div>
      <label class="small">Asset</label>
      <select class="chip" style="width: 100%" :value="store.symbol" @change="onAssetChange">
        <option v-for="s in store.assetList" :key="s" :value="s">{{ s }}</option>
      </select>
    </div>

    <div>
      <label class="small">Quantity</label>
      <div class="stepper">
        <button type="button" @click="step('qty', -1)">−</button>
        <input
          class="sim-input"
          type="number"
          step="0.0001"
          placeholder="0.0000"
          :value="store.qtyInput"
          @change="store.setQty(($event.target as HTMLInputElement).value)"
        />
        <button type="button" @click="step('qty', 1)">+</button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px">
        <input
          class="sim-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          :value="store.qtyPct"
          :style="{ background: sliderBackground(0, 100, store.qtyPct) }"
          @input="onQtyPct"
        />
        <div class="small">{{ store.qtyPct }}%</div>
        <button class="btn" type="button" @click="store.setQtyPct(100)">Max</button>
      </div>

      <div style="margin-top: 10px">
        <label class="small">Total (in selected currency)</label>
        <input
          class="sim-input"
          type="text"
          :placeholder="store.cashSource === 'USD' ? 'USD' : 'BRL'"
          style="text-align: right; width: 100%"
          :value="store.totalInput"
          @change="onTotalChange"
        />
      </div>

      <div style="margin-top: 12px; display: flex; gap: 8px">
        <button class="btn btn-primary" @click="submit">Simulate Trade</button>
        <button class="btn btn-danger" @click="emit('clear')">Clear Sim Trades</button>
      </div>
    </div>

    <div>
      <label class="small">Price (optional)</label>
      <div class="stepper">
        <button type="button" @click="step('price', -1)">−</button>
        <input
          class="sim-input"
          type="text"
          placeholder="use scenario price"
          style="text-align: right"
          :value="store.priceInput"
          @change="store.setPriceInput(($event.target as HTMLInputElement).value)"
        />
        <button type="button" @click="step('price', 1)">+</button>
      </div>

      <div style="margin-top: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 8px">
        <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end">
          <label class="small" style="margin-right: 6px; white-space: nowrap">Cash Source</label>
          <div style="display: flex; gap: 8px; align-items: center">
            <button class="chip" :class="{ active: store.cashSource === 'USD' }" type="button" @click="setCashSource('USD')">USD</button>
            <button class="chip" :class="{ active: store.cashSource === 'BRL' }" type="button" @click="setCashSource('BRL')">BRL</button>
          </div>
        </div>

        <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end">
          <div style="display: flex; gap: 8px; align-items: center">
            <label class="small" style="width: 70px">BRL</label>
            <input class="sim-input" type="text" style="width: 140px; text-align: right" :value="cashReaisText" @change="onCashReais" />
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <label class="small" style="width: 70px">USD</label>
            <input class="sim-input" type="text" style="width: 140px; text-align: right" :value="cashDollarsText" @change="onCashDollars" />
          </div>
        </div>
      </div>
    </div>
  </div>

  <div style="margin-top: 12px">
    <div style="margin-top: 24px; font-weight: 600">Simulated Trade History</div>
    <div class="table-container" style="margin-top: 8px">
      <table>
        <thead>
          <tr><th>Time</th><th>Asset</th><th>Side</th><th>Qty</th><th>Price</th><th>Total</th></tr>
        </thead>
        <tbody>
          <tr v-if="store.tradeRows.length === 0">
            <td colspan="6" class="small">No simulated trades</td>
          </tr>
          <tr v-for="(row, i) in store.tradeRows" :key="`${row.time}-${i}`">
            <td>{{ row.time }}</td>
            <td>{{ row.symbol }}</td>
            <td>{{ row.side }}</td>
            <td>{{ row.qty }}</td>
            <td class="currency">{{ row.price }}</td>
            <td class="currency">{{ row.total }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
