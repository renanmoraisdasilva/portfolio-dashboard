/**
 * The migration table.
 *
 * Each page moves from `legacy` to `migrated` as Phase 5 rewrites it in Vue.
 * The nav renders from this list, and a `migrated` entry is the one that gets
 * a real router route instead of a hand-off to `/legacy/` — so this table *is*
 * the progress display.
 */
export type PageStatus = 'legacy' | 'migrated';

export interface NavEntry {
  /** Clean path owned by the Vue app. */
  path: string;
  label: string;
  status: PageStatus;
  /** Where the untouched page lives. Absent once the page is migrated. */
  legacyHref?: string;
}

export const NAV_ENTRIES: NavEntry[] = [
  { path: '/', label: 'Dashboard', status: 'legacy', legacyHref: '/legacy/index.html' },
  { path: '/analytics', label: 'Analytics', status: 'migrated' },
  { path: '/simulation', label: 'Simulation', status: 'migrated' },
  { path: '/sql-explorer', label: 'SQL Explorer', status: 'legacy', legacyHref: '/legacy/sql-explorer.html' },
];

/** A page still served untouched from `/legacy/`, with its hand-off target. */
export function legacyEntries(): (NavEntry & { legacyHref: string })[] {
  return NAV_ENTRIES.filter(
    (entry): entry is NavEntry & { legacyHref: string } =>
      entry.status === 'legacy' && entry.path !== '/' && Boolean(entry.legacyHref),
  );
}

export function isActive(path: string, currentPath: string): boolean {
  return path === currentPath;
}
