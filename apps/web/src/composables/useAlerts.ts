import { computed, ref } from 'vue';
import type { components } from '@portfolio-dashboard/shared';
import { formatMoney, type SymbolClassifier } from '@portfolio-dashboard/shared';
import { request, useApi } from './useApi';

/**
 * The dashboard's alerts: their state, their rows, and their CRUD — extracted
 * from `stores/dashboard.ts` (IMPROVEMENT-PLAN 4.1, second slice).
 *
 * The one thing this needs from the store that owns it is the symbol
 * classifier, because an alert's figures are shown in the symbol's display
 * currency. Everything else (the API, the two lists, both row derivations) is
 * self-contained, and the three callers inside the dashboard — `load()`,
 * `addTrade()` and the return block — refer to these names unchanged.
 *
 * `Alert` and `TriggeredAlert` live here so the module has no imports from
 * the store; `stores/dashboard.ts` re-exports both for its existing consumers.
 */

export type Alert = components['schemas']['Alert'];
export type TriggeredAlert = components['schemas']['TriggeredAlert'];

export interface AlertsDeps {
  /** Classifier deciding whether an alert's figures are shown in BRL or USD. */
  readonly classifier: () => SymbolClassifier;
}

export function useAlerts(deps: AlertsDeps) {
  const api = useApi();

  const alerts = ref<Alert[]>([]);
  const triggeredAlerts = ref<TriggeredAlert[]>([]);

  const alertRows = computed(() => {
    const classifier = deps.classifier();
    return alerts.value.map((a) => {
      const brl = classifier.isBRLAsset(a.symbol ?? '');
      const money = (amount: number): string => formatMoney(amount, brl ? 'BRL' : 'USD');
      const threshold = a.threshold ?? 0;
      const label =
        a.alert_type === 'value'
          ? `${a.condition === 'below' ? 'Falls Below' : 'Rises Above'} ${money(threshold)}`
          : `${a.condition === 'below' ? 'Down' : 'Up'} ${threshold.toFixed(2)}% from ${money(a.reference_price ?? 0)}`;
      return { id: a.id ?? '', symbol: a.symbol ?? '', label, isActive: Boolean(a.is_active) };
    });
  });

  const triggeredRows = computed(() => {
    const classifier = deps.classifier();
    return triggeredAlerts.value.map((t) => {
      const brl = classifier.isBRLAsset(t.symbol ?? '');
      const money = (amount: number, maxDigits?: number): string => formatMoney(amount, brl ? 'BRL' : 'USD', maxDigits);
      const current = t.current_price ?? 0;
      const priceText =
        t.alert_type === 'value' ? money(current) : `${t.percentage_change ? t.percentage_change.toFixed(2) : '0'}%`;
      const details =
        t.previous_price && t.percentage_change
          ? `from ${money(t.previous_price)} to ${money(current)} (${t.percentage_change.toFixed(2)}% change)`
          : `Currently at ${money(current)}`;
      return {
        id: t.id ?? '',
        symbol: t.symbol ?? '',
        priceText,
        details,
        triggeredAt: t.triggered_at ? new Date(t.triggered_at).toLocaleString() : '',
      };
    });
  });

  async function loadAlerts(): Promise<void> {
    const list = await request(api.GET('/alerts'), 'GET', '/alerts');
    alerts.value = Array.isArray(list) ? list : [];
  }

  async function loadTriggeredAlerts(): Promise<void> {
    const triggered = await request(api.GET('/alerts/triggered'), 'GET', '/alerts/triggered');
    triggeredAlerts.value = Array.isArray(triggered) ? triggered : [];
  }

  async function createAlert(body: {
    symbol: string;
    alert_type: 'value' | 'percentage';
    threshold: number;
    condition: 'above' | 'below';
    reference_price?: number;
  }): Promise<string | null> {
    try {
      await request(api.POST('/alerts', { body }), 'POST', '/alerts');
    } catch (err) {
      console.warn('[dashboard] create alert failed:', err);
      return 'Error: Failed to create alert';
    }
    await Promise.all([loadAlerts(), loadTriggeredAlerts()]);
    return null;
  }

  async function deleteAlert(id: string): Promise<string | null> {
    try {
      await request(api.DELETE('/alerts/{id}', { params: { path: { id } } }), 'DELETE', '/alerts/{id}');
    } catch (err) {
      console.warn('[dashboard] delete alert failed:', err);
      return 'Error deleting alert';
    }
    await Promise.all([loadAlerts(), loadTriggeredAlerts()]);
    return null;
  }

  async function dismissAlert(id: string): Promise<void> {
    try {
      await request(
        api.POST('/alerts/dismiss/{triggeredAlertId}', { params: { path: { triggeredAlertId: id } } }),
        'POST',
        '/alerts/dismiss/{triggeredAlertId}',
      );
    } catch (err) {
      console.warn('[dashboard] dismiss alert failed:', err);
      return;
    }
    await loadTriggeredAlerts().catch((err) => console.warn('[dashboard] reload triggered alerts failed:', err));
  }

  return {
    alerts,
    triggeredAlerts,
    alertRows,
    triggeredRows,
    loadAlerts,
    loadTriggeredAlerts,
    createAlert,
    deleteAlert,
    dismissAlert,
  };
}
