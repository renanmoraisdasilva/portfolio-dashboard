import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * One test runner for the whole workspace.
 *
 * Phase 7 of docs/MODERNIZATION-PLAN.md replaced Jest. The reasons, in order of
 * how much they mattered day to day:
 *
 * 1. Jest's `rootDir` had to be the repository root, because its coverage
 *    provider only instruments files underneath it — which is why the config
 *    reached across folders into `static/js` and `packages/shared`. Vitest has
 *    no such constraint, so this config only has to name the workspaces.
 * 2. The Vue app had no tests at all, because there was no runner that could
 *    mount a component. That is the actual gap: a Vue SPA with a 400-line store
 *    and no way to assert anything about it.
 * 3. `vi` is the same object under a name that does not collide with anything,
 *    and Vite means no separate transform step — the tests read the same source
 *    the app bundles, aliases and all.
 *
 * `packages/shared` resolves to its source rather than `dist/`, so a test never
 * needs a build first. The root `build` script still builds it, because
 * `apps/api` compiles against the declarations.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@portfolio-dashboard/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'apps/api/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'packages/shared/src/**/*.test.ts',
      'static/js/__tests__/**/*.test.js',
    ],
    // Replaces `openapi-fetch` for every suite, so a store test can describe
    // what the server answers without stubbing the transport underneath it.
    setupFiles: ['./apps/web/src/test/networkHarness.ts'],
    // Component and store tests need a DOM; the rest are pure and faster in
    // node. Per-file overrides use a `// @vitest-environment jsdom` docblock.
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
    // `vi` and the Jest aliases are global so the migrated suites read the same
    // as before. `vi.mock` is hoisted above the imports it replaces, exactly
    // like `jest.mock`, so the existing suite order keeps working.
    coverage: {
      provider: 'v8',
      // Still narrow by design, and for the same reason as under Jest: a file
      // in this list is a file with tests behind it. Widen it *after* adding
      // the tests, or the gate stops meaning anything.
      include: [
        'apps/api/src/config/**',
        'apps/api/src/schema.ts',
        'apps/api/src/routes/health.ts',
        'apps/api/src/routes/portfolio.ts',
        'apps/api/src/services/cashBackfill.ts',
        'apps/api/src/services/portfolioCalculator.ts',
        'packages/shared/src/domain/**',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
