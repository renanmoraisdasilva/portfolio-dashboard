import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import { init, close as closeDatabase } from './db';
import { startWorkerJobs, stopWorkerJobs } from './jobs';

/**
 * How long a shutdown may take before the process exits anyway.
 *
 * Matches the web process's budget. Without one, a hung fetch inside a running
 * job would hold the worker open until the orchestrator killed it, and the
 * database would never be closed cleanly — which is the whole reason this
 * handler exists.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Stops the scheduled jobs and closes the database.
 *
 * Same reasoning as the web process: `telemetry.ts` registers its own SIGTERM
 * handler for the OTel SDK flush, and Node runs every listener, so the two do not
 * conflict. Closing the database checkpoints the WAL, which is what keeps a bare
 * copy of `portfolio.db` from being weeks stale.
 */
function installShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, shutting down`);

    const forced = setTimeout(() => {
      console.error('[worker] shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    stopWorkerJobs();
    closeDatabase();
    clearTimeout(forced);
    console.log('[worker] shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export async function startWorker(): Promise<void> {
  await init();
  await startWorkerJobs();
  console.log('Portfolio worker started');
  installShutdownHandlers();
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Failed to initialize worker', err);
    process.exit(1);
  });
}
