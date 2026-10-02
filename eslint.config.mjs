// ESLint flat config for the whole workspace.
//
// There was no linter before this, so
// the rule set is the recommended one for each language rather than a house
// style nobody agreed to: it catches the mistakes that matter (unused code,
// floating promises, `any` creeping in) and leaves style to Prettier.
//
// The header used to claim all three while only the first was true. The
// recommended set is not type-aware, so nothing here saw a floating promise or an
// `await` on a non-promise. `tseslint.configs.recommendedTypeChecked` is now
// included, which is what makes the claim true — and it found real bugs on the
// first run, which is the argument for it.
//
// Formatting is not duplicated here — `eslint-config-prettier` turns the
// stylistic rules off so the two tools can never disagree about a semicolon.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Build output and dependencies. Ignoring them is cheaper than a config
    // branch, and it keeps `npm run lint` from reading dist/ as source.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/.baseline/**',
      'packages/shared/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Type-aware rules, which `recommended` does not include. This is the change
  // that makes the header comment true: `no-floating-promises`,
  // `await-thenable` and `no-misused-promises` all need the type checker, and
  // without this block the config caught unused code but silently claimed to
  // catch floating promises too.
  //
  // `projectService` lets the plugin find the right tsconfig per file rather than
  // naming one here, which matters because the four TypeScript roots
  // (`apps/api`, `apps/web`, `packages/shared`, and the root config) each compile
  // under different settings — `apps/web` has no Node types on purpose.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // `defaultProject` covers the TypeScript that no application tsconfig
        // claims — the `apps/api` suites, which `apps/api/tsconfig.json`
        // deliberately excludes so `tsc` does not compile them into `dist/`, plus
        // the root `vitest.config.ts`. Without it ESLint reports "not found by the
        // project service" on 35 files, and it does so as a *parsing error*, so
        // the type-aware rules quietly stop applying to a third of the codebase.
        projectService: {
          defaultProject: 'tsconfig.eslint.json',
          // No `**` — typescript-eslint rejects it here, because a default project
          // is one program and a wide glob makes every file in it load. These are
          // the eight JavaScript files in the repository that no tsconfig covers,
          // named explicitly so that adding one is a deliberate act.
          allowDefaultProject: [
            '*.mjs',
            '*.cjs',
            'e2e/*.mjs',
            'scripts/*.mjs',
            'scripts/*.cjs',
            'scripts/k6/*.js',
            'static/js/__tests__/*.js',
            'vitest.config.ts',
            'playwright.config.ts',
            'e2e/*.ts',
            'scripts/*.ts',
            'apps/api/*.config.ts',
            'apps/web/*.config.ts',
            // One glob per directory, and **not** `**`: typescript-eslint rejects a
            // recursive glob here outright, because the default project is a single
            // program and a wide match makes every file in it load. The four test
            // directories are enumerated so that adding a fifth produces a visible
            // "not found by the project service" parse error rather than a silent
            // loss of type-aware linting.
            'apps/api/src/*.test.ts',
            'apps/api/src/config/*.test.ts',
            'apps/api/src/routes/*.test.ts',
            'apps/api/src/services/*.test.ts',
            'packages/shared/src/domain/*.test.ts',
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 64,
        },
      },
    },
  },

  // Vue single-file components. `script setup` needs the TS parser underneath,
  // which the flat config wires up via the plugin's own config.
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      // A multi-word component name is a Vue 2 convention; these components are
      // only ever referenced by their file name in templates and stores.
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    files: ['**/*.js'],
    // Plain scripts outside `apps/`: the two `static/js/__tests__` suites and
    // whatever else is loose in the tree. All ESM — the last CommonJS files were
    // converted, so `require` stays available as a global for `.cjs` interop but
    // nothing is expected to call it.
    languageOptions: {
      sourceType: 'module',
      globals: { module: 'writable', require: 'readonly', process: 'readonly', console: 'readonly' },
    },
  },

  // Browser globals for the Vue app. `globals` is not a dependency here: the
  // list is short and explicit, so a typo shows up as a lint error rather than
  // as a silently-undefined global.
  {
    files: ['apps/web/**/*.{ts,vue}', 'static/js/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        MutationObserver: 'readonly',
        performance: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        getComputedStyle: 'readonly',
      },
    },
  },

  // Config files and Node-run scripts: CommonJS by extension, ESM by `.mjs`.
  {
    files: ['**/*.cjs', '**/*.mjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    // The browser-driving scripts: Node at the top level, and browser globals
    // inside the `page.evaluate` callbacks, which are serialised and run in the
    // page. One file legitimately needs both, so it gets both.
    files: ['e2e/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },

  // The k6 script runs in k6's own runtime, not Node's and not a browser's.
  {
    files: ['scripts/k6/**/*.js'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __ITER: 'readonly',
        __VU: 'readonly',
        __TIME: 'readonly',
        http: 'readonly',
        check: 'readonly',
        sleep: 'readonly',
        exec: 'readonly',
        Trend: 'readonly',
        Rate: 'readonly',
        Counter: 'readonly',
      },
    },
  },

  // The two plain-JS suites in `static/js/__tests__` used to need
  // `no-require-imports` off, because they were the last CommonJS files in the
  // repository. They are ESM now (`AGENTS.md` records why: under Vitest 5 a
  // `require()` of a workspace package is externalised, so they kept passing while
  // their coverage landed on `packages/shared/dist` and `money.ts` read as
  // untested). So the override is gone rather than merely narrowed — nothing in
  // that directory uses `require` now, and if something started to, the rule
  // should say so.

  // Test globals. Listed rather than globbed so a stray `describe` in
  // application code is still an error - only test files get them.
  {
    files: ['**/*.test.ts', '**/*.test.js', '**/__tests__/**/*.js', '**/__tests__/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
        vi: 'readonly',
      },
    },
    rules: {
      // `expect(mock.fn)` is the normal Vitest idiom, and the rule reads it as
      // detaching a method and losing `this`. It is the assertion, not a call:
      // nothing is invoked, and `fn.bind(...)` would defeat the point by creating
      // a different function for `expect` to compare against.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Node-side code: `apps/api` and `packages/shared` run in Node, so
  // `process`/`Buffer` are in scope and the TS files need them typed. They are
  // TypeScript compiled to CommonJS, but they are *authored* as ESM, which is why
  // `sourceType: module` is right for the `.js` entries above.
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts', '*.js', '*.cjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        require: 'readonly',
        module: 'writable',
      },
    },
  },

  {
    rules: {
      // The codebase uses `_` for deliberately-unused bindings (a test name, a
      // positional arg in a row mapper, a `catch (err)` that only re-answers
      // with a generic message). That is the convention, not an oversight.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' },
      ],
      // An empty catch is legitimate in two places: tolerating a malformed
      // price-cache entry, and swallowing a deliberately-superseded rejection.
      // Both say so in a comment, which this rule accepts via `allowEmptyCatch`.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `any` is not a failure on its own, but it disables type checking
      // silently, so it has to be deliberate: `routes/prices.ts` builds a
      // response object from a dynamic key space and needs it.
      //
      // Still `warn` rather than `error`: there are 41 across 8 files
      // (`historyManager.ts` 11, `db.ts` 10, `analyticsService.ts` 8,
      // `priceFetcher.ts` 5, `routes/history.ts` 4, three singletons), and
      // promoting it before removing them would mean either 41 suppressions or a
      // diff unrelated to the rule change. Most trace to `db.ts`'s helpers
      // defaulting `T = any`, so typing those is the lever — see the note on
      // `no-unsafe-*` below, which is the same 41 `any`s seen from the far side.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off',

      // --- Disabled type-aware rules, and why -------------------------------
      //
      // These are off because they are one problem reported many times, or
      // because they fire on a pattern this codebase uses deliberately. Turning
      // a rule off is only defensible with the reason written down and a way to
      // tell when it should come back.

      // The `no-unsafe-*` family fired 462 times on the first run, against 565
      // findings in total. Almost all of it is downstream of those 41 `any`s:
      // every read, pass and return of an `any`-typed value is one of these
      // errors. Reporting one root cause as 462 errors buries the four real
      // findings underneath it, and nobody reads 462 errors.
      //
      // So: re-enable these the day `no-explicit-any` reaches zero. The lever is
      // `db.ts` — `all`/`get`/`allSync`/`getSync` are already generic but default
      // `T = any`, so `await all(...)` infers `any[]` and every caller annotates
      // `any[]` to match. Defaulting `T` to `unknown` makes each caller state its
      // row shape instead.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',

      // `router.get('/x', async (req, res) => …)` is 37 of the remaining
      // findings and every one is correct code. Express types a handler as
      // returning `void` and ignores the return value, so an `async` handler
      // "misuses" the signature by construction — and `async` is precisely how
      // these handlers do error handling, because Express 4 does **not** await a
      // handler's promise (see the note in AGENTS.md). Removing `async` would
      // delete the `try/catch` that answers a failed query with a 500.
      '@typescript-eslint/no-misused-promises': 'off',

      // Off because it produces a **wrong autofix**, which is the one property a
      // lint rule with `--fix` must not have.
      //
      // Counterexample, verified: `stores/dashboard.ts:294` is
      // `symbol: t.symbol as string` inside `normalizeTrade(t: Trade)`, and
      // `Trade` comes from the generated OpenAPI schema where every field is
      // optional — `symbol?: string`, in both `packages/shared/src/generated/api.ts`
      // and the built `dist/generated/api.d.ts`. So `t.symbol` is
      // `string | undefined`, the assertion narrows it, and `vue-tsc` needs it.
      //
      // The rule reported it as "unnecessary… does not change the type of the
      // expression", `--fix` removed all three assertions in that function, and
      // `npm run build` then failed with `TS2322: Type 'string | undefined' is not
      // assignable to type 'string'`. Two type checkers, two answers, on the same
      // file — and ESLint's is the wrong one, because its program sees the type
      // through the workspace `.d.ts` chain rather than the generated source.
      //
      // So: the dead casts it would have found are a real but small cleanup, and
      // the price of finding them automatically is a fixer that can break the
      // build. Do the casts by hand, and let `vue-tsc` be the authority.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      // Same shape, five instances: `async` handlers that answer synchronously
      // on the early-return paths, plus `db.ts`'s `init`. For a route handler
      // `async` is a property of the function, not of one branch.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Prettier last, so it wins over any stylistic rule above it.
  prettier,
);
