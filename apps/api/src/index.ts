import dotenv from 'dotenv';
dotenv.config();
import { startWeb } from './web';
import { startWorker } from './worker';

const APP_ROLE = process.env.APP_ROLE ?? 'all';

if (!['web', 'worker', 'all'].includes(APP_ROLE)) {
  throw new Error(`Invalid APP_ROLE '${APP_ROLE}'. Expected web, worker, or all.`);
}

async function start(): Promise<void> {
  if (APP_ROLE === 'worker' || APP_ROLE === 'all') await startWorker();
  if (APP_ROLE === 'web' || APP_ROLE === 'all') await startWeb();
}

start().catch((err) => {
  console.error('Failed to initialize server', err);
  process.exit(1);
});
