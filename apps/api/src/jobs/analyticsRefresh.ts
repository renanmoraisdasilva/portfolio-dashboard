import { refreshAllPeriods } from '../services/analyticsService';
import { schedule } from './scheduler';

const ANALYTICS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function startAnalyticsRefreshJob(): Promise<void> {
  try {
    await refreshAllPeriods();
    console.log('Analytics snapshots computed at startup');
  } catch (err) {
    console.warn('Analytics initial refresh failed:', err instanceof Error ? err.message : String(err));
  }

  schedule('analytics refresh', ANALYTICS_REFRESH_INTERVAL_MS, () => {
    refreshAllPeriods()
      .then(() => console.log('Analytics snapshots refreshed (scheduled)'))
      .catch((err) => console.error('Analytics scheduled refresh error:', err));
  });
}
