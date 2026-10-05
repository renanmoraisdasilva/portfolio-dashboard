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
  test('/legacy/ falls through to the Vue shell rather than serving a file', async () => {
    for (const pathname of ['/legacy/', '/legacy/index.html', '/legacy/anything.html']) {
      const res = await request(pathname);
      expect(res.status === 200 && res.body.includes('id="app"')).toBe(true);
    }
  });

  test('a bookmark with no matching page lands on the dashboard', async () => {
    for (const pathname of ['/dashboard.html', '/pages/unknown.html', '/unknown.html']) {
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
      expect(res.status).toBe(404);
    }
  });

  test('static assets stay at the root for the app shell', async () => {
    const res = await request('/static/css/layout.css');
    expect(res.status).toBe(200);
  });

  test('the repository is no longer served from the root', async () => {
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
