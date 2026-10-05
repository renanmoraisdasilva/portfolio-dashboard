import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import type { Server } from 'node:http';
import { init, close as closeDatabase } from './db';
import { createApp, mountWebRoutes } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const SHUTDOWN_TIMEOUT_MS = 10_000;

function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[web] ${signal} received, shutting down`);

    const forced = setTimeout(() => {
      console.error('[web] shutdown timed out, exiting');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    server.close((err) => {
      if (err) console.error('[web] server close failed:', err.message);
      clearTimeout(forced);
      closeDatabase();
      console.log('[web] shutdown complete');
      process.exit(err ? 1 : 0);
    });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export async function startWeb(): Promise<void> {
  await init();

  const app = createApp();
  mountWebRoutes(app);

  const server = app.listen(PORT, () => {
    console.log(`Portfolio web server listening on port ${PORT}`);
  });

  installShutdownHandlers(server);
}

if (require.main === module) {
  startWeb().catch((err) => {
    console.error('Failed to initialize web server', err);
    process.exit(1);
  });
}
