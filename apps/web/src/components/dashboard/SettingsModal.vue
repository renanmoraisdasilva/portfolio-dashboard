<script setup lang="ts">
import { ref } from 'vue';
import { useDashboardStore } from '../../stores/dashboard';
import { useToast } from '../../composables/useToast';

const store = useDashboardStore();
const { show } = useToast();

const notifyMessage = ref('');
const notifyBusy = ref(false);

async function runMaintenance(key: string, path: string): Promise<void> {
  await store.runMaintenance(key, path);
}

async function testNotify(): Promise<void> {
  notifyBusy.value = true;
  const message =
    window.prompt('Enter test notification message (leave blank for default)') ||
    'Test notification from portfolio-dashboard';
  const error = await store.testNotify(message);
  show(error ?? 'Notification sent successfully', error ? 'error' : 'success');
  notifyBusy.value = false;
}

async function clearHistory(): Promise<void> {
  await store.clearHistory();
  show('History cleared!');
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const message = await store.importData(file);
  show(message ?? 'Data imported to server!', message ? 'error' : 'success');
  input.value = '';
}
</script>

<template>
  <div class="modal" v-if="store.settingsOpen">
    <div class="modal-content settings-content">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px">
        <h2 style="margin: 0; font-size: 1.05rem">⚙ Settings &amp; Tools</h2>
        <button class="modal-close" title="Close" @click="store.settingsOpen = false">✕</button>
      </div>

      <div style="display: grid; gap: 10px">
        <div class="tool-row">
          <div>
            <div class="tool-title">🗄 SQL Explorer</div>
            <div class="tool-sub">Run SQL queries against all databases</div>
          </div>
          <a href="/legacy/sql-explorer.html" target="_blank" class="btn tool-action">Open</a>
        </div>

        <div class="tool-row">
          <div>
            <div class="tool-title">📤 Export JSON</div>
            <div class="tool-sub">Download portfolio data as JSON</div>
          </div>
          <button class="btn tool-action" @click="store.exportData()">Export</button>
        </div>

        <div class="tool-row">
          <div>
            <div class="tool-title">📥 Import JSON</div>
            <div class="tool-sub">Restore portfolio from a JSON backup</div>
          </div>
          <label class="btn tool-action">
            Import
            <input type="file" accept="application/json" style="display: none" @change="onImportFile" />
          </label>
        </div>

        <div class="tool-row">
          <div>
            <div class="tool-title">🔔 Test Notify</div>
            <div class="tool-sub">Send a test alert via Home Assistant</div>
          </div>
          <button class="btn tool-action" :disabled="notifyBusy" @click="testNotify">
            {{ notifyBusy ? 'Sending...' : 'Send' }}
          </button>
        </div>

        <div class="tool-row tool-row-top">
          <div style="flex: 1; min-width: 0">
            <div class="tool-title">🔄 Fill History Gaps</div>
            <div class="tool-sub">Backfill missing portfolio history snapshots</div>
            <pre v-if="store.maintenanceLog['fill-gaps']" class="tool-log">{{ store.maintenanceLog['fill-gaps'] }}</pre>
          </div>
          <button
            class="btn tool-action"
            :disabled="store.busyMigration === 'fill-gaps'"
            @click="runMaintenance('fill-gaps', '/api/history/fill-gaps')"
          >
            {{ store.busyMigration === 'fill-gaps' ? 'Running…' : 'Run' }}
          </button>
        </div>

        <div class="tool-row tool-row-danger">
          <div>
            <div class="tool-title">🗑 Clear History</div>
            <div class="tool-sub">Delete all portfolio history snapshots</div>
          </div>
          <button class="btn btn-danger tool-action" @click="clearHistory">Clear</button>
        </div>

        <div class="tool-row tool-row-danger">
          <div>
            <div class="tool-title">⚠️ Erase All</div>
            <div class="tool-sub">Permanently delete all trades, history and cash</div>
          </div>
          <button class="btn btn-danger tool-action" @click="store.settingsOpen = false; store.eraseOpen = true">Erase</button>
        </div>

        <div style="border-top: 1px solid var(--border); margin: 6px 0 2px"></div>
        <div class="tool-section">Maintenance</div>

        <div class="tool-row tool-row-top">
          <div style="flex: 1; min-width: 0">
            <div class="tool-title">💵 Backfill Cash History</div>
            <div class="tool-sub">Derive ~30 cash estimates from portfolio snapshots <span style="opacity: 0.6">(one-time)</span></div>
            <pre v-if="store.maintenanceLog['backfill-cash']" class="tool-log">{{ store.maintenanceLog['backfill-cash'] }}</pre>
          </div>
          <button
            class="btn tool-action"
            :disabled="store.busyMigration === 'backfill-cash'"
            @click="runMaintenance('backfill-cash', '/api/migrations/backfill-cash')"
          >
            {{ store.busyMigration === 'backfill-cash' ? 'Running…' : 'Run' }}
          </button>
        </div>

        <div class="tool-row tool-row-top">
          <div style="flex: 1; min-width: 0">
            <div class="tool-title">📈 Backfill Price History</div>
            <div class="tool-sub">Fetch 2-yr daily closes from Yahoo Finance <span style="opacity: 0.6">(≈30s)</span></div>
            <pre v-if="store.maintenanceLog['backfill-prices']" class="tool-log">{{ store.maintenanceLog['backfill-prices'] }}</pre>
          </div>
          <button
            class="btn tool-action"
            :disabled="store.busyMigration === 'backfill-prices'"
            @click="runMaintenance('backfill-prices', '/api/migrations/backfill-prices')"
          >
            {{ store.busyMigration === 'backfill-prices' ? 'Running…' : 'Run' }}
          </button>
        </div>
      </div>
    </div>
  </div>

  <div class="modal" v-if="store.eraseOpen">
    <div class="modal-content">
      <h2>Erase all data?</h2>
      <p>This will erase all trades and history. This cannot be undone.</p>
      <button style="background: #ef4444" @click="store.eraseAll()">Erase</button>
      <button @click="store.eraseOpen = false">Cancel</button>
    </div>
  </div>

  <div class="modal" v-if="store.deleteTradeIndex !== null">
    <div class="modal-content">
      <h2>Delete trade?</h2>
      <p>This will remove this trade from your history. This cannot be undone.</p>
      <button style="background: #ef4444" @click="store.confirmDeleteTrade()">Delete</button>
      <button @click="store.deleteTradeIndex = null">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.settings-content {
  text-align: left;
  width: min(480px, calc(100vw - 32px));
  max-height: 85vh;
  overflow-y: auto;
}
.modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 2px 8px;
  line-height: 1;
}
.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--border);
}
.tool-row-top {
  align-items: flex-start;
}
.tool-row-danger {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.25);
}
.tool-title {
  font-weight: 600;
  font-size: 0.875rem;
}
.tool-sub {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 3px;
}
.tool-section {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 2px 4px;
}
.tool-action {
  margin: 0;
  flex-shrink: 0;
}
.tool-log {
  margin: 8px 0 0;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: 6px;
  font-size: 0.7rem;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}
</style>
