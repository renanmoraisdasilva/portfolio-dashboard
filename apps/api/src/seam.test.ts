import fs from 'node:fs';
import path from 'node:path';
import { createApp, mountWebRoutes } from './app';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const hasWebBuild = fs.existsSync(path.join(repoRoot, 'apps', 'web', 'dist', 'index.html'));

async function request(pathname: string): Promise<{ status: number; location: string | null; body: string }> {
  const app = createApp();
  mountWebRoutes(app);
  const server = app.listen(0);
  try {
    const { port } = server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location'), body: await res.text() };
  } finally {
    server.close();
  }
}

describe('strangler seam', () => {
  test('the SQL Explorer is the only page still served from /legacy/', async () => {
    const res = await request('/legacy/sql-explorer.html');
    expect(res.status).toBe(200);
    expect(res.body).toContain('sql');
  });

  test('every migrated page is gone from /legacy/', async () => {
    // No such files any more: the static mount misses and the SPA fallback
    // answers with the shell, so assert on what the body is not.
    for (const page of ['index', 'analytics', 'simulation']) {
      const res = await request(`/legacy/${page}.html`);
      expect(res.body).not.toContain('period-tabs');
      expect(res.body).not.toContain('asset-rows');
      expect(res.body).not.toContain('metrics-grid');
      expect(res.body).not.toContain(`/static/js/${page}.js`);
    }
  });

  test('old /pages/* links redirect to /legacy/*', async () => {
    const res = await request('/pages/sql-explorer.html');
    expect([301, 302]).toContain(res.status);
    expect(res.location).toBe('/legacy/sql-explorer.html');
  });

  test('bookmarks of a migrated page follow it to its Vue route', async () => {
    const expected: Array<[string, string]> = [
      ['/analytics.html', '/analytics'],
      ['/pages/analytics.html', '/analytics'],
      ['/simulation.html', '/simulation'],
      ['/pages/simulation.html', '/simulation'],
    ];
    for (const [pathname, target] of expected) {
      const res = await request(pathname);
      expect([301, 302]).toContain(res.status);
      expect(res.location).toBe(target);
    }
  });

  test('the dashboard bookmark lands on the Vue app', async () => {
    const res = await request('/index.html');
    expect([301, 302]).toContain(res.status);
    expect(res.location).toBe('/');
  });

  test('old bookmark paths redirect to /legacy/', async () => {
    const res = await request('/sql-explorer.html');
    expect([301, 302]).toContain(res.status);
    expect(res.location).toBe('/legacy/sql-explorer.html');
  });

  test('the root serves the Vue dashboard, never the legacy page', async () => {
    const res = await request('/');
    if (hasWebBuild) {
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="app"');
      expect(res.body).not.toContain('metrics-grid');
    } else {
      // No build yet (bare `npm test`): the root must still not fall back to
      // the legacy page, which is what the seam is for.
      expect(res.status).toBe(404);
    }
  });

  test('static assets stay at the root for the legacy pages', async () => {
    const res = await request('/static/css/layout.css');
    expect(res.status).toBe(200);
  });

  test('the repository is no longer served from the root', async () => {
    // Unknown paths fall through to the Vue shell, so assert the file itself
    // never leaks rather than asserting a 404.
    const leaks: Array<[string, string]> = [
      ['/package.json', 'portfolio-dashboard'],
      ['/apps/api/src/app.ts', 'mountWebRoutes'],
      ['/node_modules/express/package.json', '"name": "express"'],
    ];
    for (const [pathname, marker] of leaks) {
      const res = await request(pathname);
      expect(res.body).not.toContain(marker);
    }
  });
});
