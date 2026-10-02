import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

/**
 * One test runner for the whole workspace.
 *
 * Vitest replaced Jest. The reasons, in order of
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
    // Vitest 4 removed `environmentMatchGlobs` in favour of projects, so the
    // node/jsdom split is expressed here rather than as a path glob. Two
    // projects also means the web project's setup file applies only to the web
    // suites, rather than loading `openapi-fetch`'s replacement into the API's.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'apps/api/src/**/*.test.ts',
            'packages/shared/src/**/*.test.ts',
            'static/js/__tests__/**/*.test.js',
            // The project's own configuration integrity, which needs `node:fs`.
            // It lives here rather than in the web project because that project
            // deliberately has no Node types - see the `css: true` note below for
            // the same trade in the other direction.
            'scripts/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.ts'],
          // Replaces `openapi-fetch`, so a store test can describe what the
          // server answers without stubbing the transport underneath it.
          setupFiles: ['./apps/web/src/test/networkHarness.ts'],
          // Vitest replaces a `.css` import with an empty string unless this is
          // on, and `?raw` does not bypass it - only the CSS pipeline sees it.
          // `shellStylesheetScope.test.ts` reads the page stylesheets that way,
          // because they sit outside `apps/web` and reading them through
          // `node:fs` would mean adding `"types": ["node"]` to the browser app
          // for the sake of one test. No other suite in this project imports CSS,
          // so processing it costs nothing here, and it would also surface a
          // broken `@import` rather than silently stubbing it.
          css: true,
        },
      },
    ],
    globals: true,
    coverage: {
      provider: 'v8',
      // Narrow on purpose, and it is important to be honest about what that means:
      // a file in this list is a file with tests behind it, so the 80% gate below
      // says something true about those files and **nothing at all about the rest
      // of `src/`**. Every entry here was a file the moment someone wrote a test
      // for it; `cashBackfill.ts` stayed listed after the file was deleted, which
      // is what 5.3 was, and it is the reason this list cannot be trusted without
      // a check (see `scripts/config-integrity.test.ts`).
      //
      // So the ungated number is published alongside it rather than left implied.
      // `npm run test:coverage` reports the gated subset; `npm run test:coverage:full`
      // reports all of `src/` with no threshold, which is the number to quote when
      // asking "how much of this codebase is tested". Neither replaces the other:
      // the subset is the gate because it can be held at 80% honestly, and the
      // whole is the measurement because it cannot.
      //
      // **What the full number currently is, and why.** Around 31% statements, and
      // it is not that the tested code is bad — `packages/shared/src/domain` is at
      // ~99.7% and `useApi.ts` at 100%. It is that the Vue single-file components
      // read 0%, because no test mounts one: `MetricCards.vue`, `PositionsTable.vue`,
      // every view. Those are genuinely uncovered rather than unmeasurable (the
      // report lists their uncovered line ranges), and they are the largest single
      // gap in the project — 4.2 in the review plan. So the number is a fair
      // measure of how much of *this* codebase is tested, and it says the next
      // meaningful increase comes from component tests, not from more domain tests.
      include: [
        'apps/api/src/config/**',
        'apps/api/src/schema.ts',
        'apps/api/src/routes/health.ts',
        'apps/api/src/routes/portfolio.ts',
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
