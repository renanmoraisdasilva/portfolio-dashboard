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
export type PageStatus = 'legacy' | 'migrated';

export interface NavEntry {
  /** Clean path owned by the Vue app. */
  path: string;
  label: string;
  status: PageStatus;
  /** Where the untouched page lives. Absent once the page is migrated. */
  legacyHref?: string;
  /** Dashboard sub-view. Only `/` has one; selects it via `?tab=`. */
  tab?: 'dashboard' | 'assetCharts';
}

/**
 * Order is the header's order: dashboard first, then its sub-view, then the
 * other pages, then the one page still served from `/legacy/`.
 */
export const NAV_ENTRIES: NavEntry[] = [
  { path: '/', label: 'Dashboard', status: 'migrated', tab: 'dashboard' },
  { path: '/', label: 'Asset Charts', status: 'migrated', tab: 'assetCharts' },
  { path: '/simulation', label: 'Simulation', status: 'migrated' },
  { path: '/analytics', label: 'Analytics', status: 'migrated' },
  { path: '/sql-explorer', label: 'SQL Explorer', status: 'legacy', legacyHref: '/legacy/sql-explorer.html' },
];

/** A page still served untouched from `/legacy/`, with its hand-off target. */
export function legacyEntries(): (NavEntry & { legacyHref: string })[] {
  return NAV_ENTRIES.filter(
    (entry): entry is NavEntry & { legacyHref: string } =>
      entry.status === 'legacy' && entry.path !== '/' && Boolean(entry.legacyHref),
  );
}

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
