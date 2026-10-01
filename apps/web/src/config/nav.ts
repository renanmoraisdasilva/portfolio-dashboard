/**
 * The navigation table.
 *
 * This is the single source of truth for the one header row every page shares:
 * the shell renders it, and no page implements navigation of its own. A page
 * that wanted its own buttons would be inventing a second row, which is exactly
 * what this replaced.
 *
 * `tab` exists because Asset Charts is a view *within* the dashboard rather than
 * a page of its own. It gets its own entry so it can be linked to and marked
 * active, which means the dashboard route has to accept a tab — otherwise the
 * nav could only ever reach it from the dashboard it lives inside, and a reload
 * would drop you back to the overview.
 */
export interface NavEntry {
  /** Clean path owned by the Vue app. */
  path: string;
  label: string;
  /** Dashboard sub-view. Only `/` has one; selects it via `?tab=`. */
  tab?: 'dashboard' | 'assetCharts';
}

/**
 * Order is the header's order: dashboard first, then its sub-view, then the
 * other pages.
 *
 * Every entry is `migrated`, so there is no `status` field and no `legacyEntries()`
 * any more. The SQL Explorer was the last page still served from `pages/`, and it
 * was the only reason a nav entry could point somewhere the Vue app did not own:
 * an unauthenticated arbitrary-SQL console behind an environment flag, which was
 * not worth migrating and not worth keeping. With it gone the Vue app owns every
 * route the header links to, and `LegacyHandoff.vue` went with it.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { path: '/', label: 'Dashboard', tab: 'dashboard' },
  { path: '/', label: 'Asset Charts', tab: 'assetCharts' },
  { path: '/simulation', label: 'Simulation' },
  { path: '/analytics', label: 'Analytics' },
];

/**
 * Is this entry the current one?
 *
 * The two dashboard entries share a path, so path alone marks both active. The
 * tab has to be part of the comparison, which is why the dashboard tab is now a
 * URL parameter rather than store state: a location a link can point at is the
 * only kind that survives a reload.
 */
export function isActive(entry: NavEntry, currentPath: string, currentTab?: string): boolean {
  if (entry.path !== currentPath) return false;
  if (!entry.tab) return currentPath !== '/';
  return entry.tab === currentTab;
}

/** Where an entry points, including the dashboard's tab. */
export function entryTo(entry: NavEntry): { path: string } & Record<string, unknown> {
  return entry.tab ? { path: entry.path, query: { tab: entry.tab } } : { path: entry.path };
}
