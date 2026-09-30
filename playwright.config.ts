import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests for the three pages, in a real browser.
 *
 * Until now, "the page still works" was
 * established by opening it and looking: three phases of migrations were verified
 * that way, and the numbers were compared by hand. That is not repeatable and it
 * is not reviewable, so the manual step is becoming three tests.
 *
 * The server runs from the real `dist/` build against a database seeded from
 * `fixtures/portfolio_data.json` - synthetic data. The
 * trade the suite adds lands in that throwaway database, so the assertion on the
 * totals afterwards is the same arithmetic a person was doing by hand.
 */
export default defineConfig({
  testDir: './e2e',
  // One worker: the tests share one seeded database, and a second worker would
  // race it on the trade they add.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3199',
    trace: 'retain-on-failure',
    // The page polls prices and the worker is not running, so nothing here
    // should be waiting on a network that never answers.
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // A dedicated port and data directory, so a run can never touch the
    // developer's own `apps/api/data/portfolio.db`.
    command: 'node e2e/start-server.mjs',
    url: 'http://127.0.0.1:3199/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
