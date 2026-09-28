import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
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
  test('the legacy dashboard is served from /legacy/', async () => {
    const res = await request('/legacy/index.html');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/legacy/analytics.html');
  });

  test('old /pages/* links redirect to /legacy/*', async () => {
    const res = await request('/pages/analytics.html');
    expect([301, 302]).toContain(res.status);
    expect(res.location).toBe('/legacy/analytics.html');
  });

  test('old bookmark paths redirect to /legacy/', async () => {
    const res = await request('/simulation.html');
    expect([301, 302]).toContain(res.status);
    expect(res.location).toBe('/legacy/simulation.html');
  });

  test('the root serves the Vue app, never the legacy dashboard', async () => {
    const res = await request('/');
    if (hasWebBuild) {
      expect(res.status).toBe(200);
      expect(res.body).toContain('id="app"');
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
