import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import { init } from './db';
import { createApp, mountWebRoutes } from './app';
import { financeRouter } from './routes/finance';
import { initFinanceDB } from './services/financeService';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

export async function startWeb(): Promise<void> {
  await init();

  const app = createApp();
  mountWebRoutes(app);

  try {
    await initFinanceDB();
    app.use('/api/finance', financeRouter);
    console.log('Finance DB initialized and /api/finance route mounted');
  } catch (err) {
    console.warn('Failed to initialize finance DB', err instanceof Error ? err.message : String(err));
  }

  app.listen(PORT, () => {
    console.log(`Portfolio web server listening on port ${PORT}`);
  });
}

if (require.main === module) {
  startWeb().catch(err => {
    console.error('Failed to initialize web server', err);
    process.exit(1);
  });
}
