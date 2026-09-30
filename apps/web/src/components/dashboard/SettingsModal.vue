<script setup lang="ts">
import { ref } from 'vue';
import { useDashboardStore } from '../../stores/dashboard';
import { useToast } from '../../composables/useToast';

/**
 * Four tools, and that is deliberate.
 *
 * The modal used to carry nine: Fill History Gaps, Clear History, Erase All,
 * Backfill Cash History and Backfill Price History are gone. Two reasons.
 *
 * *Some were one-time repairs for bad data that no longer exists.* Backfill Cash
 * History in particular ran `DELETE FROM cash` and rebuilt the balance from
 * estimates - a single click with no confirmation zeroed the entire USD balance
 * and destroyed every cash entry belonging to a trade. It had already done its
 * job; leaving it on the screen was leaving a loaded gun next to the backup
 * button. (The figure is deliberately not quoted here: this comment ships to
 * every visitor, and a real balance is not a showcase detail.)
 *
 * *The rest belong to the application, not to a person.* Clearing history and
 * erasing everything are maintenance operations with no legitimate everyday use,
 * and a restore from a JSON backup is now a true replace, so it covers the
 * "start over from a known state" case properly.
 *
 * The backfills' capability is not lost, only its button: `price_ticks` refills
 * itself from Yahoo on the worker's schedule, and the worker keeps taking
 * snapshots. If history density ever needs a repair, that belongs in the worker,
 * where it cannot be forgotten or run by accident.
 */
const store = useDashboardStore();
const { show } = useToast();

const notifyBusy = ref(false);

async function testNotify(): Promise<void> {
  notifyBusy.value = true;
  const message =
    window.prompt('Enter test notification message (leave blank for default)') || 'Test notification from portfolio-dashboard';
  const error = await store.testNotify(message);
  show(error ?? 'Notification sent successfully', error ? 'error' : 'success');
  notifyBusy.value = false;
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  // A restore replaces every table the backup carries, so it needs the same
  // kind of confirmation Erase All used to have - one click on a file picker
  // should not be able to discard a trade or the history.
  const confirmed = window.confirm(
    `Restore from "${file.name}"?\n\nEvery trade, snapshot, interest month, cash entry, alert and scenario is replaced by the file's contents. Anything not in the file is removed. This cannot be undone.`,
  );
  if (!confirmed) {
    input.value = '';
    return;
  }
  const message = await store.importData(file);
  show(message ?? 'Data restored from backup', message ? 'error' : 'success');
  input.value = '';
}
</script>

<template>
  <div v-if="store.settingsOpen" class="modal">
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
            <div class="tool-sub">Back up everything: trades, history, interest, cash, alerts, scenarios, prices and charts</div>
          </div>
          <button class="btn tool-action" @click="store.exportData()">Export</button>
        </div>

        <div class="tool-row tool-row-top">
          <div style="flex: 1; min-width: 0">
            <div class="tool-title">📥 Import JSON</div>
            <div class="tool-sub">
              Restore from a backup. Replaces every table the file contains - anything not in the file is removed.
            </div>
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
      </div>
    </div>
  </div>

  <div v-if="store.deleteTradeIndex !== null" class="modal">
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
.tool-title {
  font-weight: 600;
  font-size: 0.875rem;
}
.tool-sub {
  color: var(--text-muted);
  font-size: 0.75rem;
  margin-top: 3px;
}
.tool-action {
  margin: 0;
  flex-shrink: 0;
}
</style>
