<script setup lang="ts">
import { computed } from 'vue';
import { useSimulationStore } from '../../stores/simulation';

const store = useSimulationStore();

const rows = computed(() =>
  store.scenarios
    .filter((s): s is typeof s & { id: string } => Boolean(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name ?? '',
      created: s.createdAt ? new Date(s.createdAt).toLocaleString() : '',
      updated: s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '',
    })),
);

async function confirmSave(): Promise<void> {
  const message = await store.confirmSaveScenario();
  window.alert(message ?? 'Scenario saved');
}

async function load(id: string): Promise<void> {
  const warning = await store.loadScenario(id);
  window.alert(warning ?? 'Scenario loaded');
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Delete selected scenario?')) return;
  const message = await store.deleteScenario(id);
  window.alert(message ?? 'Scenario deleted');
}
</script>

<template>
  <div class="modal" v-if="store.saveModalOpen">
    <div class="modal-content">
      <h2>Save Scenario</h2>
      <div class="row">
        <input v-model="store.scenarioName" type="text" placeholder="Scenario name" />
      </div>
      <div class="row">
        <label class="small">Overwrite existing:</label>
        <select v-model="store.scenarioOverwriteId">
          <option value="">(New scenario)</option>
          <option v-for="row in rows" :key="row.id" :value="row.id">
            {{ row.name }} — {{ row.updated }}
          </option>
        </select>
      </div>
      <div class="actions">
        <button class="btn" @click="store.saveModalOpen = false">Cancel</button>
        <button class="btn btn-primary" @click="confirmSave">Save</button>
      </div>
    </div>
  </div>

  <div class="modal" v-if="store.openModalOpen">
    <div class="modal-content">
      <h2>Open Scenario</h2>
      <div style="max-height: 360px; overflow: auto">
        <table>
          <thead>
            <tr><th>Name</th><th>Created</th><th>Last Saved</th><th>Actions</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ row.name }}</td>
              <td class="small">{{ row.created }}</td>
              <td class="small">{{ row.updated }}</td>
              <td>
                <button class="btn" @click="load(row.id)">Load</button>
                <button class="btn btn-danger" @click="remove(row.id)">Delete</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="actions">
        <button class="btn" @click="store.openModalOpen = false">Close</button>
      </div>
    </div>
  </div>
</template>
