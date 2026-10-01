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
  test('there is no /legacy/ mount and no pages/ tree any more', async () => {
    // The SQL Explorer was the last vanilla page. With it gone there is nothing
    // for `/legacy/` to serve, so the directory is retired rather than left
    // mounted against an empty path: a request that used to return the page must
    // fall through to the Vue shell instead of a 200 from static.
    for (const pathname of ['/legacy/', '/legacy/sql-explorer.html', '/legacy/index.html']) {
      const res = await request(pathname);
      expect(res.status === 200 && res.body.includes('id="app"')).toBe(true);
    }
  });

  test('a bookmark for a retired page lands on the dashboard, not a dead /legacy/ URL', async () => {
    // The fallback used to be `/legacy/<name>.html`, which no longer resolves.
    // Sending these to `/` keeps an old bookmark useful instead of 404ing.
    for (const pathname of ['/sql-explorer.html', '/pages/sql-explorer.html', '/dashboard.html']) {
      const res = await request(pathname);
      expect([301, 302]).toContain(res.status);
      expect(res.location).toBe('/');
    }
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

  test('the root serves the Vue dashboard, never a legacy page', async () => {
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

  test('static assets stay at the root for the app shell', async () => {
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
