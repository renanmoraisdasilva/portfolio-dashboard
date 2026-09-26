import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import { init } from './db';
import { startWorkerJobs } from './jobs';

export async function startWorker(): Promise<void> {
  await init();
  await startWorkerJobs();
  console.log('Portfolio worker started');
}

if (require.main === module) {
  startWorker().catch(err => {
    console.error('Failed to initialize worker', err);
    process.exit(1);
  });
}
