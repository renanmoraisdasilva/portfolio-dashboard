import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import { init, close as closeDatabase } from './db';
import { startWorkerJobs, stopWorkerJobs } from './jobs';

const SHUTDOWN_TIMEOUT_MS = 10_000;

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
