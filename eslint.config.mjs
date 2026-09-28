// ESLint flat config for the whole workspace.
//
// Phase 7 of docs/MODERNIZATION-PLAN.md. There was no linter before this, so
// the rule set is the recommended one for each language rather than a house
// style nobody agreed to: it catches the mistakes that matter (unused code,
// floating promises, `any` creeping in) and leaves style to Prettier.
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
    // The two remaining plain-script test suites and config files.
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

  // Config files that run in Node as CommonJS.
  {
    files: ['**/*.cjs', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly', process: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
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

  // The two remaining plain-JS test suites are CommonJS under Jest, so
  // `require` is the import syntax they use.
  {
    files: ['static/js/__tests__/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

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
  },

  // Node-side code. `apps/api` and `packages/shared` are CommonJS, so
  // `process`/`Buffer` are in scope and the TS files need them typed.
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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },

  // Prettier last, so it wins over any stylistic rule above it.
  prettier,
);
