/**
 * The SQL Explorer is an arbitrary-SQL console over HTTP with no
 * authentication, so it must stay closed unless ENABLE_SQL_EXPLORER=true.
 * The flag is read per app creation, which is what lets this test cover both
 * states.
 */
import express from 'express';
import { createApp, mountWebRoutes } from './app';

async function statusOf(app: express.Express, path: string): Promise<number> {
  const server = app.listen(0);
  try {
    const address = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
    return response.status;
  } finally {
    server.close();
  }
}

describe('SQL Explorer gate', () => {
  const original = process.env.ENABLE_SQL_EXPLORER;

  afterEach(() => {
    if (original === undefined) delete process.env.ENABLE_SQL_EXPLORER;
    else process.env.ENABLE_SQL_EXPLORER = original;
  });

  test('off by default: /api/sql/* answers 403', async () => {
    delete process.env.ENABLE_SQL_EXPLORER;
    const app = createApp();
    mountWebRoutes(app);
    await expect(statusOf(app, '/api/sql/tables')).resolves.toBe(403);
  });

  test('enabled: /api/sql/tables answers 200', async () => {
    process.env.ENABLE_SQL_EXPLORER = 'true';
    const app = createApp();
    mountWebRoutes(app);
    await expect(statusOf(app, '/api/sql/tables')).resolves.toBe(200);
  });
});
