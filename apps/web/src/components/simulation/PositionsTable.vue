<script setup lang="ts">
import { useSimulationStore } from '../../stores/simulation';
import AssetIcon from './AssetIcon.vue';

const store = useSimulationStore();
</script>

<template>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Qty</th>
          <th>Avg Price</th>
          <th>Current Price</th>
          <th>Value</th>
          <th>P/L</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="store.positionRows.length === 0">
          <td colspan="6" class="small">No open positions</td>
        </tr>
        <tr v-for="row in store.positionRows" :key="row.symbol">
          <td><AssetIcon :symbol="row.symbol" /> {{ row.symbol }}</td>
          <td>{{ row.qty }}</td>
          <td class="currency">{{ row.avg }}</td>
          <td class="currency">{{ row.cur }}</td>
          <td class="currency">{{ row.value }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.pl }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
