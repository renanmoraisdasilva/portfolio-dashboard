<script setup lang="ts">
import { useDashboardStore } from '../../stores/dashboard';

const store = useDashboardStore();
</script>

<template>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Asset</th>
          <th>Side</th>
          <th>Qty</th>
          <th>Price</th>
          <th>Total</th>
          <th>Profit</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="store.tradeRows.length === 0">
          <td colspan="8" class="empty-state">No trades yet.</td>
        </tr>
        <tr v-for="(row, i) in store.tradeRows" :key="row.id ?? i">
          <td>{{ row.time }}</td>
          <td>{{ row.symbol }}</td>
          <td>
            <span class="badge" :class="row.isBuy ? 'badge-success' : 'badge-danger'">{{ row.side }}</span>
          </td>
          <td>{{ row.qty }}</td>
          <td>{{ row.price }}</td>
          <td>{{ row.total }}</td>
          <td>
            <span :class="row.profit.positive === null ? 'neutral' : row.profit.positive ? 'positive' : 'negative'">
              {{ row.profit.text }}
            </span>
          </td>
          <td>
            <button class="btn btn-danger" style="padding: 2px 8px; font-size: 0.9em" @click="store.requestDeleteTrade(i)">
              ✖
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
