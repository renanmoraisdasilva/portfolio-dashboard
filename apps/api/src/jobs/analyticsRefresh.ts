import { refreshAllPeriods } from '../services/analyticsService';

const ANALYTICS_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function startAnalyticsRefreshJob(): Promise<void> {
  try {
    await refreshAllPeriods();
    console.log('Analytics snapshots computed at startup');
  } catch (err) {
    console.warn('Analytics initial refresh failed:', err instanceof Error ? err.message : String(err));
  }

  setInterval(async () => {
    try {
      await refreshAllPeriods();
      console.log('Analytics snapshots refreshed (scheduled)');
    } catch (err) {
      console.error('Analytics scheduled refresh error:', err);
    }
  }, ANALYTICS_REFRESH_INTERVAL_MS);
}
