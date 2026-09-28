<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import { useSimulationStore } from '../stores/simulation';
import { useDocumentTitle } from '../composables/useDocumentTitle';
import AssetRows from '../components/simulation/AssetRows.vue';
import AllocationPanel from '../components/simulation/AllocationPanel.vue';
import PositionsTable from '../components/simulation/PositionsTable.vue';
import ScenarioModals from '../components/simulation/ScenarioModals.vue';
import SimulationMetrics from '../components/simulation/SimulationMetrics.vue';
import TradeForm from '../components/simulation/TradeForm.vue';

import '../../../../static/css/simulation.css';

const store = useSimulationStore();

useDocumentTitle('Portfolio Simulation');

/** The vanilla page collapsed this layout below 430px with a body class. */
function applyCompactMode(): void {
  document.body.classList.toggle('compact-sim', window.innerWidth <= 430);
}

onMounted(async () => {
  applyCompactMode();
  window.addEventListener('resize', applyCompactMode);
  window.addEventListener('orientationchange', applyCompactMode);
  await store.load();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', applyCompactMode);
  window.removeEventListener('orientationchange', applyCompactMode);
});

function confirmThen(message: string, action: () => void): void {
  if (window.confirm(message)) action();
}

function clearTrades(): void {
  confirmThen('Clear simulated trades and reset cash to real values?', () => store.clearTrades());
}

function reset(): void {
  confirmThen('Reset simulation: clear trades and reset prices/cash to real values?', () => store.reset());
}
</script>

<template>
  <PageHeader icon="📈" title="Portfolio Simulation" subtitle="What-if scenarios, allocation and trade planning">
    <template #actions>
      <button class="btn" @click="reset">Reset to Real Values</button>
      <button class="btn" @click="store.openScenariosModal()">Open Scenario</button>
      <button class="btn" @click="store.openSaveModal()">Save Scenario</button>
    </template>
  </PageHeader>

  <SimulationMetrics />

  <div class="layout">
    <div>
      <div class="card">
        <div class="card-header"><div style="font-weight: 600">What-If Portfolio Simulator</div></div>
        <AssetRows />
      </div>

      <div class="card" style="margin-top: 12px">
        <div class="card-header"><div style="font-weight: 600">Asset Allocation</div></div>
        <AllocationPanel />
      </div>

      <div class="card" style="margin-top: 12px">
        <div class="card-header"><div style="font-weight: 600">Simulated Positions</div></div>
        <PositionsTable />
      </div>
    </div>

    <div>
      <div class="card">
        <div class="card-header"><div style="font-weight: 600">Plan Trade</div></div>
        <TradeForm @clear="clearTrades" />
      </div>
    </div>
  </div>

  <ScenarioModals />
</template>
