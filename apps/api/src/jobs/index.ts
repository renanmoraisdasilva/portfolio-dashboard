import { startAnalyticsRefreshJob } from './analyticsRefresh';
import { startHistorySnapshotJob } from './historySnapshot';
import { startPriceRefreshJob } from './priceRefresh';

export async function startWorkerJobs(): Promise<void> {
  await startPriceRefreshJob();
  await startAnalyticsRefreshJob();
  await startHistorySnapshotJob();
}
