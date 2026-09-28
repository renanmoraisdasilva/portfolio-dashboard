<script setup lang="ts">
import { computed, ref } from 'vue';
import { useDashboardStore } from '../../stores/dashboard';
import { useToast } from '../../composables/useToast';

const store = useDashboardStore();
const { show } = useToast();

const symbol = ref('');
const alertType = ref<'value' | 'percentage'>('value');
const condition = ref<'below' | 'above'>('below');
const threshold = ref('');
const referencePrice = ref('');

const isPercentage = computed(() => alertType.value === 'percentage');
const thresholdLabel = computed(() => {
  if (isPercentage.value) return 'Change %';
  return symbol.value && store.isBRLAsset(symbol.value) ? 'Threshold (R$)' : 'Threshold ($)';
});

async function create(): Promise<void> {
  const parsed = parseFloat(threshold.value);
  if (!symbol.value || isNaN(parsed)) {
    show('Please fill in all fields', 'error');
    return;
  }
  const reference = isPercentage.value ? parseFloat(referencePrice.value) : undefined;
  if (isPercentage.value && (isNaN(reference as number) || (reference as number) <= 0)) {
    show('Please enter a valid reference price for percentage-based alerts', 'error');
    return;
  }

  const message = await store.createAlert({
    symbol: symbol.value,
    alert_type: alertType.value,
    threshold: parsed,
    condition: condition.value,
    ...(reference !== undefined ? { reference_price: reference } : {}),
  });
  if (message) {
    show(message, 'error');
    return;
  }
  symbol.value = '';
  threshold.value = '';
  referencePrice.value = '';
  alertType.value = 'value';
  condition.value = 'below';
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Are you sure you want to delete this alert?')) return;
  const message = await store.deleteAlert(id);
  if (message) show(message, 'error');
}

async function dismiss(id: string): Promise<void> {
  await store.dismissAlert(id);
}
</script>

<template>
  <div v-if="store.triggeredRows.length > 0" class="triggered-banner">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px">
      <div style="flex: 1">
        <h3 style="margin: 0 0 8px; color: #ef4444; font-size: 1rem; display: flex; align-items: center; gap: 8px">
          <span>⚠️</span><span>Active Price Alerts</span>
        </h3>
        <div style="display: grid; gap: 8px">
          <div v-for="row in store.triggeredRows" :key="row.id" class="alert-item">
            <div class="alert-item-info">
              <strong>{{ row.symbol }}</strong> -
              <span style="color: var(--text-secondary)">{{ row.priceText }}</span>
              <br />
              <span style="font-size: 0.85rem; color: var(--text-muted)">{{ row.details }} • Triggered: {{ row.triggeredAt }}</span>
            </div>
            <button class="alert-item-close" @click="dismiss(row.id)">Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="alerts-inner-pad" style="padding: 16px">
    <div class="alerts-form-pad" style="margin-bottom: 20px; padding: 16px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border)">
      <h3 style="margin-bottom: 14px; font-size: 1.05rem">Create New Alert</h3>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px">
        <div>
          <label class="field-label">Asset</label>
          <select v-model="symbol" class="field-control">
            <option value="">Select asset...</option>
            <option v-for="s in store.symbolList" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div>
          <label class="field-label">Alert Type</label>
          <select v-model="alertType" class="field-control">
            <option value="value">Price Value</option>
            <option value="percentage">Percentage Change</option>
          </select>
        </div>
        <div>
          <label class="field-label">Condition</label>
          <select v-model="condition" class="field-control">
            <option value="below">Falls Below</option>
            <option value="above">Rises Above</option>
          </select>
        </div>
        <div>
          <label class="field-label">{{ thresholdLabel }}</label>
          <input v-model="threshold" type="number" class="field-control" placeholder="e.g., 50000 or 10" step="0.01" />
        </div>
        <div v-if="isPercentage">
          <label class="field-label">Reference Price</label>
          <input v-model="referencePrice" type="number" class="field-control" placeholder="e.g., 50000" step="0.01" />
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px">The baseline price to calculate percentage change from</p>
        </div>
      </div>
      <button class="btn btn-primary" style="width: 100%; padding: 10px; font-weight: 600" @click="create">Create Alert</button>
    </div>

    <div style="margin-bottom: 16px">
      <h3 style="margin-bottom: 14px; font-size: 1.05rem">Active Alerts</h3>
      <div style="display: grid; gap: 12px">
        <p v-if="store.alertRows.length === 0" style="color: var(--text-muted); text-align: center; padding: 20px">
          No alerts configured yet.
        </p>
        <div
          v-for="row in store.alertRows"
          :key="row.id"
          style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--bg-tertiary); border-radius: 8px; border: 1px solid var(--border)"
        >
          <div style="flex: 1">
            <strong style="font-size: 1rem; color: var(--text-primary)">{{ row.symbol }}</strong>
            <span style="margin-left: 12px; color: var(--text-secondary); font-size: 0.9rem">{{ row.label }}</span>
            <span style="margin-left: 12px; color: var(--text-muted); font-size: 0.85rem">Active: {{ row.isActive ? '✓' : '✗' }}</span>
          </div>
          <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.85rem" @click="remove(row.id)">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.triggered-banner {
  display: block;
  margin-bottom: 16px;
  padding: 14px 16px;
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.1));
  border: 1px solid #ef4444;
  border-radius: 10px;
  animation: slideDown 0.3s ease;
}
.field-label {
  display: block;
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
}
.field-control {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.95rem;
}
</style>
