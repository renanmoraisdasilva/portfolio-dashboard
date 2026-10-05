export interface NavEntry {
  path: string;
  label: string;
  tab?: 'dashboard' | 'assetCharts';
}

export const NAV_ENTRIES: NavEntry[] = [
  { path: '/', label: 'Dashboard', tab: 'dashboard' },
  { path: '/', label: 'Asset Charts', tab: 'assetCharts' },
  { path: '/simulation', label: 'Simulation' },
  { path: '/analytics', label: 'Analytics' },
];

export function isActive(entry: NavEntry, currentPath: string, currentTab?: string): boolean {
  if (entry.path !== currentPath) return false;
  if (!entry.tab) return currentPath !== '/';
  return entry.tab === currentTab;
}

export function entryTo(entry: NavEntry): { path: string } & Record<string, unknown> {
  return entry.tab ? { path: entry.path, query: { tab: entry.tab } } : { path: entry.path };
}
