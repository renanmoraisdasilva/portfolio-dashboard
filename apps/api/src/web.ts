import './telemetry';
import dotenv from 'dotenv';
dotenv.config();
import type { Server } from 'node:http';
import { init, close as closeDatabase } from './db';
import { createApp, mountWebRoutes } from './app';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

/**
 * How long a shutdown may take before the process exits anyway.
 *
 * `server.close()` waits for in-flight requests, so a hung keep-alive socket or a
 * request that never finishes would otherwise hold the process open until the
 * orchestrator's own timeout killed it — which is the outcome this is meant to
 * avoid, just less politely. Long enough for a real request to complete, short
 * enough that a deploy is not stalled.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/**
 * Stops accepting connections, lets in-flight requests finish, then closes the
 * database so the WAL is checkpointed.
 *
 * Both halves matter and the order matters. `docker stop` sends SIGTERM and gives
 * a grace period; without a handler Node exits immediately, so a request in
 * flight is cut off mid-response (the proxy answers 502) and `portfolio.db-wal`
 * is left uncheckpointed — which is how a bare copy of `portfolio.db` came to
 * hold a 7-week-old state.
 *
 * `telemetry.ts` registers its own SIGTERM/SIGINT handler for the OTel SDK, and
 * both run: Node invokes every listener, and `process.once` means each fires
 * exactly once. The SDK's flush is independent of the database close, so the two
 * do not race over anything.
 */
function installShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals) => {
    // A second Ctrl-C should not start a second shutdown over the first one's
    // still-closing socket.
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[web] ${signal} received, shutting down`);

    // Backstop: if `close()` never calls back, stop waiting. `unref` so the timer
    // does not itself keep the process alive during a clean shutdown.
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
