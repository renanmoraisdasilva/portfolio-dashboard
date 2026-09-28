<script setup lang="ts">
import { useDashboardStore } from '../../stores/dashboard';

const store = useDashboardStore();
</script>

<template>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Quantity</th>
          <th>Avg Price</th>
          <th>Current Price</th>
          <th>Value</th>
          <th>P/L</th>
          <th>P/L %</th>
        </tr>
      </thead>
      <tbody>
        <template v-if="store.hasPriceError">
          <tr>
            <td colspan="7" class="empty-state">Error fetching prices.</td>
          </tr>
        </template>
        <template v-else-if="store.positionRows.length === 0 && store.cashPositionRows.length === 0">
          <tr>
            <td colspan="7" class="empty-state">No open positions yet.</td>
          </tr>
        </template>
        <tr v-for="row in store.positionRows" v-else :key="row.symbol">
          <td>{{ row.symbol }}</td>
          <td>{{ row.qty }}</td>
          <td>{{ row.avg }}</td>
          <td>{{ row.cur }}</td>
          <td>{{ row.value }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.pl }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.plPct }}</td>
        </tr>
        <tr v-for="row in store.cashPositionRows" :key="row.symbol">
          <td>{{ row.symbol }}</td>
          <td>{{ row.qty }}</td>
          <td>{{ row.avg }}</td>
          <td>{{ row.cur }}</td>
          <td>{{ row.value }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.pl }}</td>
          <td :class="row.positive ? 'positive' : 'negative'">{{ row.plPct }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
