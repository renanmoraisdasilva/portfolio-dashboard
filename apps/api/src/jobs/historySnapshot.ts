import { computeAndInsertHistoryPoint } from '../services/historyManager';

const HISTORY_INTERVAL_MS = 30 * 60 * 1000;

export async function startHistorySnapshotJob(): Promise<void> {
  try {
    const result = await computeAndInsertHistoryPoint({ manual: false });
    if (result) console.log('Initial history point inserted', result.ts);
  } catch (err) {
    console.warn('Initial history point not created:', err instanceof Error ? err.message : String(err));
  }

  setInterval(async () => {
    try {
      const result = await computeAndInsertHistoryPoint({ manual: false });
      if (result) console.log('Scheduled history point inserted', result.ts);
    } catch (err) {
      console.error('History point insertion error', err);
    }
  }, HISTORY_INTERVAL_MS);
}
