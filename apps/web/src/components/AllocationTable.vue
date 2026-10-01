<script setup lang="ts">
import { computed } from 'vue';
import { ASSET_COLORS } from '../composables/useAnalyticsCharts';
import { useAnalyticsStore } from '../stores/analytics';
import { fmtUSD } from '../composables/useMoney';

const store = useAnalyticsStore();

const rows = computed(() => {
  const positions = store.costVsMarket;
  const assets = Object.keys(positions);
  const totalMarket = assets.reduce((sum, asset) => sum + positions[asset].market, 0);

  return assets.map((asset) => {
    const { cost, market } = positions[asset];
    const pnl = market - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return {
      asset,
      color: ASSET_COLORS[asset] || '#94a3b8',
      allocPct: totalMarket > 0 ? (market / totalMarket) * 100 : 0,
      cost,
      market,
      pnl,
      pnlPct,
      /** The bar is a fixed 50% scale, so ±50% fills it. */
      barPct: Math.min(100, (Math.abs(pnlPct) / 50) * 100),
    };
  });
});
</script>

<template>
  <div style="overflow-x: auto">
    <table class="alloc-table">
      <thead>
        <tr>
          <th>Asset</th>
          <th>Allocation</th>
          <th>Cost Basis</th>
          <th>Market Value</th>
          <th>Unrealized P/L</th>
          <th>P/L %</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td colspan="6" style="text-align: center; color: #475569; padding: 32px">No position data</td>
        </tr>
        <tr v-for="row in rows" :key="row.asset">
          <td>
            <div class="asset-badge">
              <div class="asset-swatch" :style="{ background: row.color }"></div>
              {{ row.asset }}
            </div>
          </td>
          <td>{{ row.allocPct.toFixed(1) }}%</td>
          <td>{{ fmtUSD(row.cost) }}</td>
          <td>{{ fmtUSD(row.market) }}</td>
          <td :class="row.pnl >= 0 ? 'positive' : 'negative'">{{ row.pnl >= 0 ? '+' : '−' }}{{ fmtUSD(Math.abs(row.pnl)) }}</td>
          <td>
            <div class="pnl-bar-wrap">
              <div class="pnl-bar-bg">
                <div class="pnl-bar-fill" :class="row.pnl < 0 ? 'negative' : ''" :style="{ width: `${row.barPct}%` }"></div>
              </div>
              <span :class="row.pnl >= 0 ? 'positive' : 'negative'" style="min-width: 48px; text-align: right; font-weight: 600">
                {{ row.pnl >= 0 ? '+' : '' }}{{ row.pnlPct.toFixed(1) }}%
              </span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
