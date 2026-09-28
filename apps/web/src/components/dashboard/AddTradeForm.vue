<script setup lang="ts">
import { computed } from 'vue';
import { useDashboardStore, type Side } from '../../stores/dashboard';
import { useToast } from '../../composables/useToast';

const store = useDashboardStore();
const { show } = useToast();

const priceLabel = computed(() => (store.isBRLAsset(store.formSymbol) ? 'Price (R$)' : 'Price (USD)'));
const totalPlaceholder = computed(() =>
  store.formCashSource === 'USD' ? 'enter total in USD' : 'enter total in BRL',
);
const availableUsd = computed(() => store.usd(store.cashDollars));
const availableBrl = computed(() => store.brl(store.cashReais));

function step(field: 'qty' | 'price', delta: number): void {
  if (field === 'qty') {
    store.setQty(String(Math.round(((parseFloat(store.qtyInput) || 0) + delta) * 1e4) / 1e4));
    return;
  }
  store.setPrice(String(+Math.max(0, (parseFloat(store.priceInput) || 0) + delta).toFixed(2)));
}

async function submit(): Promise<void> {
  const message = await store.addTrade();
  if (message) show(message, 'error', 5000);
  else show('Trade recorded');
}

function setSide(side: Side): void {
  store.setFormSide(side);
}
</script>

<template>
  <div class="trade-grid">
    <div class="trade-left">
      <div class="row">
        <div class="col-side">
          <label class="small">Side</label>
          <div class="side-seg" style="display: flex; gap: 8px; align-items: center">
            <button class="chip" :class="{ active: store.formSide === 'buy' }" type="button" @click="setSide('buy')">Buy</button>
            <button class="chip" :class="{ active: store.formSide === 'sell' }" type="button" @click="setSide('sell')">Sell</button>
          </div>
        </div>

        <div class="col-asset">
          <label class="small">Asset</label>
          <select
            style="width: 100%"
            :value="store.formSymbol"
            @change="store.formSymbol = ($event.target as HTMLSelectElement).value; store.syncPriceToSymbol()"
          >
            <option v-for="s in store.symbolList" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <div style="flex: 1">
          <label class="small">Quantity</label>
          <div class="stepper">
            <button type="button" @click="step('qty', -1)">−</button>
            <input
              class="sim-input"
              type="number"
              placeholder="0.0000"
              step="any"
              :value="store.qtyInput"
              @change="store.setQty(($event.target as HTMLInputElement).value)"
            />
            <button type="button" @click="step('qty', 1)">+</button>
          </div>
        </div>

        <div style="flex: 1">
          <label class="small">{{ priceLabel }}</label>
          <div class="stepper">
            <button type="button" @click="step('price', -1)">−</button>
            <input
              class="sim-input"
              type="number"
              placeholder="0.00"
              step="any"
              :value="store.priceInput"
              @change="store.setPrice(($event.target as HTMLInputElement).value)"
            />
            <button type="button" @click="step('price', 1)">+</button>
          </div>
        </div>

        <div style="flex: 1">
          <label class="small">Date</label>
          <input class="sim-input" type="date" style="width: 100%" :value="store.tradeDate" @change="store.tradeDate = ($event.target as HTMLInputElement).value" />
        </div>
      </div>

      <div class="row inline-row">
        <div class="trade-slider-wrap">
          <div class="trade-details">
            <div class="slider-row">
              <input
                class="sim-slider"
                type="range"
                min="0"
                max="100"
                step="1"
                :value="store.qtyPct"
                :style="{ background: `linear-gradient(90deg,#7c3aed ${store.qtyPct}%, rgba(255,255,255,0.06) ${store.qtyPct}%)` }"
                @input="store.setQtyPct(Number(($event.target as HTMLInputElement).value) || 0)"
              />
              <div class="small">{{ store.qtyPct }}%</div>
              <button class="btn small" type="button" @click="store.setQtyPct(100)">Max</button>
            </div>
          </div>
        </div>
        <div class="trade-total-wrap">
          <div class="total-row">
            <label class="small">TOTAL</label>
            <input
              class="sim-input"
              type="text"
              :placeholder="totalPlaceholder"
              :value="store.totalInput"
              @change="store.setTotal(($event.target as HTMLInputElement).value)"
            />
          </div>
          <button class="btn btn-primary trade-add-btn" @click="submit">Add Trade</button>
        </div>
      </div>
    </div>

    <div class="trade-right">
      <div>
        <label class="small">Cash Source</label>
        <div style="display: flex; gap: 8px; margin-top: 6px">
          <button class="chip" :class="{ active: store.formCashSource === 'USD' }" type="button" @click="store.setCashSource('USD')">USD</button>
          <button class="chip" :class="{ active: store.formCashSource === 'BRL' }" type="button" @click="store.setCashSource('BRL')">BRL</button>
        </div>
      </div>

      <div>
        <label class="small" style="margin-top: 16px">Available Cash</label>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 6px">
          <div class="available-row"><span>USD</span><b>{{ availableUsd }}</b></div>
          <div class="available-row"><span>BRL</span><b>{{ availableBrl }}</b></div>
        </div>
      </div>
    </div>
  </div>
</template>
