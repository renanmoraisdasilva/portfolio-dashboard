import { ref } from 'vue';
import { ApiError, request, useApi } from './useApi';

/**
 * The settings modal: its visibility and its three tools — export, import and
 * test notification — plus the formatter that turns a rejected import into a
 * human message. Extracted from `stores/dashboard.ts` (IMPROVEMENT-PLAN 4.1,
 * second slice).
 *
 * Two things belong to the owning store and arrive here as deps rather than
 * imports, which is what keeps this module a leaf (no cycle back into the
 * store): the local snapshot `exportData` falls back to when the server
 * export fails, and the reload `importData` runs after a backup has replaced
 * every table. Both are getters, so they read the live refs at call time.
 */

interface ImportProblem {
  table: string;
  index: number | null;
  reason: string;
}

const MAX_RENDERED_PROBLEMS = 6;

export function importErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details as { problems?: unknown; omitted?: unknown } | null;
  const problems = Array.isArray(details?.problems) ? (details.problems as ImportProblem[]) : null;
  if (err.status !== 400 || !problems?.length) return err.message;

  const shown = problems.slice(0, MAX_RENDERED_PROBLEMS);
  const lines = shown.map((p) => `${p.index === null ? p.table : `${p.table}[${p.index}]`}: ${p.reason}`);
  const omitted = typeof details?.omitted === 'number' ? details.omitted : 0;
  const notShown = problems.length - shown.length + omitted;
  if (notShown > 0) lines.push(`…and ${notShown} more`);

  const total = problems.length + omitted;
  return [`Backup rejected — ${total} problem${total === 1 ? '' : 's'}:`, ...lines].join('\n');
}

export interface SettingsDeps {
  /** The local snapshot export falls back to when the server export fails. */
  readonly fallbackSnapshot: () => Record<string, unknown>;
  /** Reload the dashboard's server state after a backup replaces every table. */
  readonly afterImport: () => Promise<void>;
}

export function useSettings(deps: SettingsDeps) {
  const api = useApi();

  const settingsOpen = ref(false);

  async function exportData(): Promise<void> {
    let payload: unknown;
    try {
      payload = await request(api.GET('/state/export'), 'GET', '/state/export');
    } catch (err) {
      console.warn('[dashboard] server export failed, falling back to a local snapshot:', err);
      payload = deps.fallbackSnapshot();
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'portfolio_data.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  async function importData(file: File): Promise<string | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return 'Invalid JSON.';
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Not a backup file.';

    try {
      await request(api.POST('/state/import', { body: parsed }), 'POST', '/state/import');
    } catch (err) {
      console.warn('[dashboard] import failed:', err);
      return importErrorMessage(err);
    }
    await deps.afterImport();
    return 'Data imported to server!';
  }

  async function testNotify(message: string): Promise<string | null> {
    try {
      await request(
        api.POST('/alerts/test-notify', { body: { title: 'Portfolio Test Notification', message } }),
        'POST',
        '/alerts/test-notify',
      );
      return null;
    } catch (err) {
      console.warn('[dashboard] test notify failed:', err);
      return err instanceof ApiError ? err.message : 'Notification failed';
    }
  }

  return { settingsOpen, exportData, importData, testNotify };
}
