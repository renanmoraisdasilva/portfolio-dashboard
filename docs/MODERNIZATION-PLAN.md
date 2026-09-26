# Modernization Plan

**Target stack:** Vue 3 + TypeScript + Vite · strangler-pattern migration · npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`)

**Invariant:** every phase ends with a running app and a green test suite. One PR per step, conventional commits.

> **Status: Phase 0, Phase 1 and Phase 1.5 are complete, and the scrubbed history has been force-pushed.** This file now lives in `docs/` (the Phase 1 rename). Completed items are checked, with any deviation from the original wording noted in place.

### Decisions made while executing Phases 0–1

- **Baseline artifacts are gitignored, not committed.** `.baseline/` holds `test-baseline.txt` plus 12 screenshots (6 before, 6 after) — they show real net-worth and income figures, so they stay out of git. Phase 5 parity re-runs against them locally.
- **`better-sqlite3` → `^13.0.3` inside Phase 1.** v9 had no prebuild for Node 22, so `npm install` died on `prebuild-install` (no Python/MSVC on this machine). v13 ships prebuilds for win32, linux, **linuxmusl** and darwin, engines `>=22`. This turned the test suite from Docker-only into a native `npm test`, which is what CI and local dev actually want. Dockerfile base went `node:18-alpine` → `node:22-alpine` to match.
- **Root `.npmrc` sets `ignore-scripts=true`.** npm auto-runs `node-gyp rebuild` for any package shipping a `binding.gyp` — i.e. `better-sqlite3` — which fails without a C++ toolchain. Its prebuilds make the build pointless anyway; esbuild resolves its binary from platform-specific optionalDependencies. Side benefit: no dependency can run arbitrary code at install time.
- **`allowScripts` belongs in the root `package.json`** — npm 11 ignores the field when it appears in a workspace manifest (it warns and drops it).
- **`migrate:init` had been dead for a while** and was fixed as part of fixture validation: it INSERTed `trades.profit` (dropped by Drizzle migration `0003`), referenced a `cash_positions` table that was never in the schema, ignored `interestDollarsMonths`, and defaulted USD interest months to `BRL`. Verified end-to-end in an ephemeral container against the new fixture.
- **`scripts/README.md` stays where it is** — it is a folder-local readme for the scripts next to it, not a top-level doc. Deviation from the "move all docs" step.
- **The vocabulary module is being deleted, not migrated** (decision recorded after Phase 1). It is unused and will not be used, so instead of porting it to Vue it is removed outright — see **Phase 1.5**. That takes the app from three SQLite databases down to two and drops one of the five pages from the Phase 5 migration order.
- **Finance moves to its own private repository** (decision recorded after Phase 1). This repo is going public as a portfolio showcase, so the genuinely personal material — income, fixed and eventual expenses, credit-card balances, tithes, multi-year records — has to live somewhere GitHub-private. A repository has exactly **one** visibility flag, so a workspace folder inside this monorepo *cannot* be private: Finance gets its own repo and its own `finance.db`. This repo keeps only portfolio — dashboard + asset charts, simulation, analytics. See **Phase 1.6**.
- **✅ Real data purged from git history** (done after Phase 1). `backup-data/**`, the root-level `portfolio_data.json` and `hist.json` were stripped from **every one of the 134 commits** reachable from all refs, so those paths never existed at any point in history. Messages, authors, dates, the 3 merge commits and the `pre-modernization` tag were all preserved; both GPG signatures were dropped (a signature cannot survive a rewrite). `npm run check` stayed green (build + 387 tests) and the resulting tree is byte-identical to the pre-rewrite tree. **Nothing has been pushed yet** — a `git push --force` is what actually removes it from GitHub, and the two stale `copilot/create-sql-query-tool-page*` branches still carry the old objects until they are deleted server-side. One local artifact remains on purpose: a single line in the `refs/stash` reflog still pins the pre-rewrite objects (reflogs are never pushed).

---

## Current state (baseline findings)

- **Frontend:** 6 plain-script files, no build step, all global scope, loaded via `<script>` tags in `pages/*.html`.

  | File | Lines |
  |------|-------|
  | `static/js/dashboard.js` | 2,144 |
  | `static/js/finance.js` | 1,510 |
  | `static/js/simulation.js` | 1,042 |
  | `static/js/vocabulary.js` | 972 |
  | `static/js/analytics.js` | 926 |

- **Duplicated helpers:** `formatMoney`/`parseMoney` exist in `lib/format.js`, `dashboard.js:775`, `simulation.js:248`, and are *re-implemented inside* `__tests__/brl-usd-calculations.test.js:19`. `showToast` exists in `lib/toast.js` and `dashboard.js:32`. `isBRLAsset`/`isBRLNonBond`/`isBRLBond` exist in `dashboard.js:82` and `simulation.js:57`.
- **Dead `lib/`:** `lib/api.js` and `lib/toast.js` are ESM, `lib/format.js` is CJS (`module.exports`), and **no HTML page loads any of them** — only `lib/analytics-insights.js` is referenced (by `analytics.html:209`), and `lib/format.js` is only reached by jest.
- **Shadowed function:** `normalizeFinanceData` is defined in **both** `finance.js:153` and `finance-utils.js:1`, and `finance.html` loads both scripts (lines 414–415). One silently wins.
- **Business logic in the browser:** `simulation.js` implements `buildLotsFromTradesCombined()` (line 268) and `computePortfolioFromCombined()` (line 286), duplicating `portfolioCalculator.replayFIFOLots()` on the server. BRL/USD conversion and totals are computed client-side at `dashboard.js:1185` and `simulation.js:311-331`.
- **Backend:** TypeScript + Express + Drizzle, reasonably layered, but ~~**3 SQLite databases with 3 migration strategies**~~ -> **2 databases since Phase 1.5** (`portfolio.db` = Drizzle; `finance.db` = inline `ALTER TABLE`), ~~conditional route mounting~~ -> only `/api/finance` is still conditional *(and leaves with Phase 1.6)*, and a `runF/getF/allF` helper-suffix convention ~~(`runV/getV/allV` deleted in Phase 1.5)~~.
- **Test coupling:** `apps/api/jest.config.cjs` has `roots: ['<rootDir>/src', '<rootDir>/../static/js']` — reaches across folders. *(repointed in Phase 1)*
- **Coverage:** thresholds enforced at 80%, but `collectCoverageFrom` instruments only 5 files.
- **Repo hygiene:** ~~`backup-data/` holds real personal finance data~~ → replaced by synthetic `fixtures/`; ~~`documentation/DDIA-case-study.md`~~ → moved out of the repo; `openapi.yaml` (42 KB) → `apps/api/openapi.yaml`; no `LICENSE` → added MIT; CI only built a Docker image → `ci.yml` added (lint still deferred to Phase 7); `pages/sql-explorer.html` is an arbitrary-SQL console exposed over HTTP *(still open — Phase 3)*.
- **Unwanted feature:** the **vocabulary-learning module** — `pages/vocabulary-learning.html`, `static/js/vocabulary.js`, `static/css/vocabulary.css`, three backend files, a `/api/vocab` router that mounts conditionally, and its own third SQLite database — is not used and will not be kept. **Deleted in Phase 1.5.** The exact inventory that was removed is listed below.
- **The Finance boundary is already clean.** `AGENTS.md` states *"Finance data is fully isolated from portfolio data (separate DB, separate routes)"*, and table ownership proves it: `finance.db` holds only incomes / fixed / eventual expenses / credit / tithes / year records. `cash`, `interest`, `scenarios` and `alerts` look finance-ish but are **`portfolio.db`** tables, consumed by the pages that stay — `dashboard.js` → cash + interest + alerts, `analytics.js` → cash, `simulation.js` → scenarios. They do **not** move with Finance.

---

## Phase 0 — Safety net (no code changes) — ✅ complete

- [x] Tag the starting point: `git tag pre-modernization`
- [x] Record baseline: `npm test` — 15 suites / **387 tests passing**, 99.65% stmts on the narrow instrumentation → `.baseline/test-baseline.txt`
- [x] Screenshot all 6 pages against seeded data (`docker compose -f docker-compose.local.yml up -d --build`): `index`, `finance`, `simulation`, `analytics`, `vocabulary-learning`, `sql-explorer` → `.baseline/01..06-*.png` *(gitignored — real figures)*
- [x] Confirm the golden fixture reproduces identical numbers every time (`npm run seed:local` + the portfolio fixture) — the seed is deterministic and idempotent (skips when the DB already has rows)
- [x] Add a root `check` script running API build + tests, giving CI one entry point

**Exit:** `npm run check` passes ✅, screenshots archived ✅.

---

## Phase 1 — Monorepo skeleton + hygiene — ✅ complete

Pure `git mv` work — preserves history and unblocks everything else.

- [x] Root `package.json` with workspaces `["apps/*", "packages/*"]`; root scripts: `dev`, `build`, `test`, `typecheck`, `check`, plus `start`/`start:web`/`start:worker`/`test:coverage`/`test:docker`/`migrate:init`/`seed:local`/`db:generate`/`db:studio` so every command in the docs works from the root. **`lint` is not added yet** — the script lands with ESLint in Phase 7.
- [x] `git mv server apps/api` — the strangler keeps `apps/api` serving the legacy pages, so nothing breaks *(history preserved: `git log --follow` still works; status shows `R`)*
- [x] Create empty `packages/shared` and `apps/web` (scaffold comes in Phase 4)
- [x] **Fix test-root coupling:** repointed `apps/api/jest.config.cjs` `roots` → `<rootDir>/../../static/js`, coverage `format.js` → `../../static/js/lib/format.js`
- [x] **Move docs:** `ARCHITECTURE-OVERVIEW.md`, `README-backend.md`, `HOME_ASSISTANT_SETUP.md` → `docs/`. **Deviation:** `scripts/README.md` stays put (folder-local readme for the scripts beside it).
- [x] **Move `documentation/DDIA-case-study.md` (47 KB) out of the repo entirely** — now at `Documents\Personal\DDIA-case-study.md`
- [x] **Sanitize fixtures:** `backup-data/` → `fixtures/` with fully synthetic data *(generated by a throwaway script, not committed)*. Validated against the originals: identical field/path structure (array lengths differ by design), `p === v - i` on every history row, 12-month array lengths, cash entries summing exactly to `cashReais`/`cashDollars`, unique UUIDs, UTF-8 accents intact, and a leak scan for personal identifiers.
- [x] **Delete legacy:** `backup-data/server/old__docker-compose.yml`. **Note:** `old__update.sh` and the root `update.sh` were never tracked — nothing to delete. `server/dist/` and `server/coverage/` were already gitignored; stale remote branches left alone.
- [x] **Move `openapi.yaml` → `apps/api/openapi.yaml`** *(Swagger UI verified serving at `/api/docs` after the move)*
- [x] **Add `LICENSE`** (MIT) and audit `.env.example`
- [x] **Add `.github/workflows/ci.yml`:** typecheck → test → build on push/PR. **Deviation:** `lint` step deferred to Phase 7 (no linter exists yet, and a script that doesn't exist fails the workflow). `docker-image.yml` was **not** made `needs: ci` — it already runs on `main` only, and gating it adds a round trip without blocking anything that isn't already covered by the PR check.

**Exit:** `npm i && npm run check` works from the repo root ✅; `git status` shows mostly renames ✅.

---

## Phase 1.5 — Remove the vocabulary module

Numbered out of sequence on purpose: it is a deletion, not a build-out, and it must land **before Phase 3** (which otherwise has to consolidate three databases instead of two) and **before Phase 5** (whose first migration slot was the vocabulary page). Nothing later needs renumbering.

**Rationale:** the vocabulary-learning feature is not used and will not be used. It is not part of the portfolio/finance showcase, so porting it to Vue would be pure cost — it is deleted outright instead.

**Inventory — ~2,260 lines to delete:**

| Area | Files | Lines |
|------|-------|-------|
| Frontend page | `pages/vocabulary-learning.html` | 127 |
| Frontend logic | `static/js/vocabulary.js` | 1,093 |
| Frontend styles | `static/css/vocabulary.css` | 466 (12.9 KB) |
| Backend route | `apps/api/src/routes/vocabulary.ts` | 148 |
| Backend service | `apps/api/src/services/vocabularyService.ts` | 173 |
| Backend DB shim | `apps/api/src/vocabularyDb.ts` | 21 |
| API spec | `apps/api/openapi.yaml` — `Vocabulary` tag, 9 `/vocab*` paths, 6 schemas | ~230 |

- [x] **Backend:** delete `vocabularyDb.ts`, `services/vocabularyService.ts`, `routes/vocabulary.ts`; drop the `VocabularyEntry` interface from `apps/api/src/models.ts:42` and the `vocabularyService.ts` mention in the `schema.ts` header comment
- [x] **Unmount the conditional router** in `apps/api/src/web.ts` — remove the `vocabularyRouter` import (line 8), `initVocabularyDB` import (line 9), the `await initVocabularyDB()` + `app.use('/api/vocab', …)` + success log (lines 28–30) and the `catch` that swallows init failures (line 32). This is one of only two conditionally-mounted routers in the app, so the whole try/catch collapses
- [x] **Remove the legacy redirect** `apps/api/src/app.ts:60` (`/vocabulary-learning.html` → `/pages/…`)
- [x] **Frontend:** delete the three files above
- [x] **Remove nav buttons:** `pages/index.html:25` (`#tabVocab`) and `pages/analytics.html:20`
- [x] **API spec:** drop the `Vocabulary` tag (`openapi.yaml:31-32`), the `/vocab*` paths (~517–657) and the `Vocabulary*` schemas (~1340–1420) from `apps/api/openapi.yaml`
- [x] **SQL explorer:** remove `'vocabulary'` from `VALID_DBS` in `apps/api/src/routes/sqlExplorer.ts` (lines 4, 9, 15) and update `apps/api/src/routes/sqlExplorer.test.ts:156-164`, which asserts the exact tuple `['finance','portfolio','vocabulary']` and length `3`. **This is the only test that touches vocabulary** — change it in the same commit or the suite goes red
- [x] **Docker:** drop the `test -f /app/pages/vocabulary-learning.html` assertion at `apps/api/Dockerfile:60`
- [x] **Docs:** `AGENTS.md` — the "vocabulary.db" bullet under Architecture, `vocabularyDb.ts` / `vocabularyService.ts` in the backend layout, the whole **Vocabulary module** section, the `runV/getV/allV` helper-suffix bullet, the finance/vocabulary sentence under *Schema migrations*, the `routes/vocabulary.ts` row in the route table, and the two known-pitfall bullets that mention it. `docs/ARCHITECTURE-OVERVIEW.md` — the `VocabularyRoutes` and `VocabDB` Mermaid nodes, the `vocabularyService` table row, and the scaling/PostgreSQL notes. `README.md:9`
- [x] **Local data:** delete `apps/api/data/vocabulary.db` if it exists — gitignored, so nothing to remove from git; the file simply stops being created
- [x] **Baseline:** `npm run check`, rebuild the Compose stack, re-screenshot. `.baseline/05-vocabulary.png` becomes obsolete (the page no longer exists), and the "Screenshot all 6 pages" wording in Phase 0 — plus the "6 plain-script files" line at the top of this document — drops to **5 pages / 5 files** *(deviation: `npm run check` is green; the Compose rebuild and re-screenshot are deferred to the Phase 5 parity run. `.baseline/05-vocabulary.png` is now obsolete and should be ignored rather than compared against.)*

**Exit:** `grep -ri vocab` returns nothing outside `node_modules/` and `apps/api/dist/`; `npm run check` green; stack healthy with **two** databases (`portfolio.db`, `finance.db`). **Met:** `git grep -il vocab` returns nothing anywhere in the tree, `npm run check` is green, and the stack runs on two databases.

---

## Phase 1.6 — Extract Finance into its own private app

Also numbered out of sequence: it is an extraction, not a build-out, and it must land **before Phase 2** (don't write shared helpers that are about to leave the repo), **before Phase 3** (backend consolidation should see one database, not two) and **before Phase 5** (the `finance` page stops being migrated here at all).

**Why a separate repository and not a workspace:** this repo is going public as a showcase. Finance holds the personal surface — income, fixed and eventual expenses, credit-card balances (`nuRenal` / `nuJu` / `nomad`), tithes, multi-year records — and GitHub gives a repository exactly **one** visibility flag. A folder inside a public monorepo cannot be private, so Finance must be its **own private repository** with its own `finance.db`.

**The boundary is already clean**, which makes this mostly a deletion rather than a refactor: `finance.db` and `routes/finance.ts` are the only Finance-owned persistence and routing. The four finance-*looking* modules — `cash`, `interest`, `scenarios`, `alerts` — are `portfolio.db` tables used by pages that stay, so they remain here.

**Inventory — ≈3,750 lines move out:**

| Area | Items |
|------|-------|
| Route | `apps/api/src/routes/finance.ts` (312) — all `/api/finance/*`: incomes, fixed, eventual, credit, years, import |
| Database | `apps/api/src/financeDb.ts` (53), `finance.db`, and the `runF`/`getF`/`allF` + `yearFilter()` convention |
| Service | `apps/api/src/services/financeService.ts` (479) + `financeService.test.ts` (568) |
| DB tests | `apps/api/src/financeDb.test.ts` (68) |
| Frontend | `pages/finance.html` (417), `static/js/finance.js` (1,659), `static/js/finance-utils.js` (193), `static/css/finance.css` |
| API spec | `Finance` + `Finance - Income` / `- Fixed` / `- Eventual` / `- Credit` / `- Years` tags and their paths/schemas |
| Fixtures | `fixtures/finance-data-2025.json`, `fixtures/finance-data-2026.json` |
| Nav | `pages/index.html:24` (`#tabFinance`) and `pages/analytics.html:19` |

- [ ] **Seed the private repo first:** `git clone <this-repo> finance-app` **before** deleting anything here, so Finance inherits the already-scrubbed history and its first push is clean. **Make it private before that first push**, then delete the portfolio half from `finance-app` and the Finance half from this repo — one PR per side
- [ ] **Sever the single cross-boundary call:** `dashboard.js` calls **`/api/finance/import`** — remove that action and its Settings UI from the portfolio dashboard (or port it into the Finance app). Do not leave a dead button behind
- [ ] **Confirm the seam is genuinely closed:** `routes/state.ts` already has zero `finance`/`getF`/`runF`/`allF` references, i.e. `GET /api/state` export/import touches `portfolio.db` only — re-verify after the split so no finance section leaks into the state export
- [ ] **Coverage config:** `apps/api/jest.config.cjs` `collectCoverageFrom` instruments exactly 5 files, two of which are `src/financeDb.ts` and `src/services/financeService.ts`. Remove them and re-check the 80% gate — it will now rest on 3 files
- [ ] **SQL explorer:** drop `'finance'` from `VALID_DBS` → `['portfolio']` alone, and update `sqlExplorer.test.ts:156-164` in the **same commit** (it asserts both the exact tuple and the length: `3` after Phase 1.5 → `1` here)
- [ ] **Conditional mounting ends:** `finance` is the *other* conditionally-mounted router. With vocabulary gone (1.5) and finance gone (here), `web.ts` has no try/catch-gated routes left — the "silently absent routes" pitfall in `AGENTS.md` and the `/api/health` `modules:` item in Phase 3 both disappear
- [ ] **Docs:** `AGENTS.md` — the *Finance module* section, the `financeDb.ts` row in the backend layout, the `runF/getF/allF` bullet, the *Schema migrations* paragraph about `finance.db`, the `routes/finance.ts` row in the route table, the conditionally-mounted-routes pitfall, and the `finance.js` entry in the plain-scripts pitfall. Same sweep for `docs/ARCHITECTURE-OVERVIEW.md` and `README.md`
- [ ] **Exit check:** `grep -riE 'api/finance|financeDb|financeService'` returns nothing in this repo; `npm run check` green; stack healthy on **one** database (`portfolio.db`); all remaining pages load

**Exit:** this repo = portfolio only (dashboard + asset charts, simulation, analytics), one database, no personal-finance surface anywhere; `finance-app` private and running on its own DB.

---

## Phase 2 — `packages/shared`: contracts + pure domain logic

This is where "logic baked in the frontend" starts dying.

- [ ] **Generate API types from `apps/api/openapi.yaml`** (`openapi-typescript` → `packages/shared/src/generated/api.d.ts`, plus `openapi-fetch` for the client)
- [ ] **Add a contract test** asserting every mounted Express route appears in the spec — prevents drift between 19 route files and the 42 KB spec
- [ ] **`packages/shared/src/domain/money.ts`** — single definition of `formatMoney`, `parseMoney`, `isBRLAsset`, `isBRLNonBond`, `isBRLBond`, BRL⇄USD conversion, total-value math
- [ ] **`packages/shared/src/domain/finance.ts`** — `normalizeFinanceData`, `parseBRNumber`, `formatBRNumber`, `validateData`. **Phase 1.6 takes this file out of the repo**: `normalizeFinanceData` is defined only in `finance.js` / `finance-utils.js`, which only `finance.html` loads, and no other page imports `finance-utils.js`. Port it here **only** if a portfolio page actually needs a BR-number helper — otherwise both this bullet and the shadowed-definition landmine leave with Finance
- [ ] **Move `apps/api/src/services/portfolioCalculator.ts` into `packages/shared`** (already pure: "no DB calls, fully testable") and have `apps/api` import it — centerpiece of Phase 6
- [ ] **Delete `lib/`** — `lib/api.js`, `lib/toast.js`, `lib/format.js` are loaded by no page; fold anything worth keeping into `packages/shared`; keep `lib/analytics-insights.js` content (moves in Phase 5)

**Exit:** duplicated helpers have exactly one definition; contract test green.

---

## Phase 3 — Backend consolidation

Do this *before* the Vue work — the frontend needs one predictable API to build against.

- [ ] **One migration strategy:** it collapses to *the* strategy — `schema.ts` stays the single source of truth for `portfolio.db` and `npm run db:migrate` is the only migration command. **Phases 1.5 and 1.6 removed the other two databases**, so there is no `schema/vocabulary.ts`, no `schema/finance.ts`, no inline `ALTER TABLE` and no `financeDb.ts` init left to reconcile — the "3 databases with 3 migration strategies" finding is simply gone
- [ ] **Kill the `runF`/`getF`/`allF` suffix convention** — replace with per-domain repos (`portfolioRepo`, `analyticsRepo`, …) closing over their own connection and exposing `run/get/all`. *(`runV/getV/allV` left with Phase 1.5, `runF/getF/allF` left with Phase 1.6 — so only `run`/`get`/`all` remain, and the suffix convention itself can go)*
- [ ] **Stop silently dropping routes:** with both conditionally-mounted routers gone there is nothing left to swallow, so make DB init **fail fast** everywhere and delete the try/catch-gated mounting pattern; `/api/health` no longer needs a `modules: { …: 'degraded' }` list
- [ ] **Retire or justify `routes/state.ts`** — documented as "legacy aggregation"; either define it as the dashboard's BFF endpoint or delete once Vue consumes granular endpoints
- [ ] **Gate `sql-explorer`** behind `ENABLE_SQL_EXPLORER=true`, off by default in the Docker image — don't ship an open SQL endpoint
- [ ] **Widen coverage** beyond 5 files — add tests first, widen `collectCoverageFrom` second, then keep the 80% gate honest

**Exit:** one migration command, routes fail loudly, SQL explorer off by default.

---

## Phase 4 — Strangler seam: scaffold `apps/web`

- [ ] `apps/web`: Vite + Vue 3 + TS + `vue-router` + `pinia` + `chart.js` + `lightweight-charts` — both already used via CDN `<script>` tags, so moving to npm deps removes them
- [ ] Vite dev proxy `/api` → `:3000`
- [ ] **The strangler seam:** Express serves `apps/web/dist` at `/` and mounts `pages/` at **`/legacy/`**; Vue router renders migrated routes and redirects unmigrated ones to `/legacy/<page>` — progress is visible in the router table
- [ ] Build the shell only: app layout, nav, theme (reuse `static/css/base.css` + `components.css` as-is — no CSS framework yet), `useApi` composable backed by the typed client, `LegacyRedirect` view

**Exit:** `/` shows the Vue shell; `/legacy/index` renders the old dashboard untouched.

---

## Phase 5 — Migrate page by page

**Order = risk ascending.** One PR per page. **Three pages** — Phase 1.5 deleted the vocabulary page and Phase 1.6 moved `finance` out to its own repository, so both the original "cheap first win" and the largest CRUD surface are gone. `analytics` opens the sequence: read-only, isolated `/api/analytics`, no CRUD.

| # | Page | Lines | Why this position |
|---|------|-------|-------------------|
| 1 | `analytics` | 190 + 926 | Read-only, consumes `/api/analytics`; `analytics-insights.js` becomes a composable — the low-risk page that proves the pattern |
| 2 | `simulation` | 190 + 1042 | Duplicate FIFO math → replace with `packages/shared` |
| 3 | `index` (dashboard) | 538 + 2144 | The flagship — trades, history, allocation, asset charts, cash/interest/alerts. Do last, with every pattern proven |

`sql-explorer` is not migrated: Phase 3 gates it behind `ENABLE_SQL_EXPLORER` (or drops it outright).

**Per-page checklist (repeat verbatim):**

- [ ] Extract state → Pinia store; centralize the scattered `localStorage` keys (`allocCurrency`, `allocationShowCash`, `interestMonthsCollapsed`, `interestUSDMonthsCollapsed`, `simAllocCurrency`) into a persisted store plugin
- [ ] Move pure logic → `packages/shared`, **importing the real functions** — specifically fix `__tests__/brl-usd-calculations.test.js`, which currently tests a copy defined inside the test file, so it passes even if production code is broken
- [ ] Build components: `views/` + `components/{charts,tables,forms,overlays}` + `composables/` (`useMoney`, `useCurrency`, `useApi`)
- [ ] Parity: screenshot vs. Phase 0, same numbers on the golden fixture, `k6 run scripts/k6/dashboard-workflow.js` still under 1% failures / p95 < 500 ms
- [ ] **Delete the old JS file and its `<script>` tag**, flip the router redirect to the Vue view — nothing deleted before parity passes

**Exit per page:** old file gone, route renders Vue, parity documented in the PR.

---

## Phase 6 — Push logic out of the browser

- [ ] **FIFO lot math out of the client** — `simulation.js` `buildLotsFromTradesCombined()` / `computePortfolioFromCombined()` become a `/api/simulate` call *or* an import of the shared module both API and web use; the point is one implementation
- [ ] **Server owns derived values** — portfolio totals, invested cost, BRL conversion. The browser renders, it doesn't compute
- [ ] **Replace `lib/api.js`'s `null`-on-error contract** with a typed client that throws `ApiError`, then delete the corresponding warning bullet from `AGENTS.md`
- [ ] Update `AGENTS.md` as you go — it is currently the most accurate document in the repo and should stay that way

**Exit:** no domain arithmetic in `.vue` files; AGENTS.md pitfalls list shrinks.

---

## Phase 7 — Quality gates

- [ ] **ESLint** (`typescript-eslint` + `eslint-plugin-vue`) + **Prettier**, root `npm run lint`
- [ ] **Vitest everywhere** — one runner instead of jest-reaching-into-`../static/js`; migrate `.test.ts` files (config + import syntax mostly)
- [ ] **Playwright** — 2–3 smoke tests against the seeded fixture (load dashboard, add a trade, check totals), replacing manual screenshot diffing
- [ ] **CI matrix:** lint → typecheck → unit → build → Playwright, Docker job gated on it; k6 stays as a scheduled perf job with existing thresholds
- [ ] Coverage: widen instrumentation (Phase 3), keep 80%, make it real

**Exit:** PRs cannot merge red.

---

## Phase 8 — Showcase polish

- [ ] **Rewrite `README.md`** — badges (CI, coverage, license), a 10-second GIF, a Mermaid architecture diagram, tech-stack table, quickstart (`git clone && npm i && npm run dev`), and a short **"tradeoffs / what I'd do differently"** section
- [ ] **Consolidate docs:** 3 READMEs today (`README.md`, `README-backend.md`, `scripts/README.md`) → one README + `docs/`
- [ ] **Final secret/data scan:** confirm `apps/api/data/*.db` never entered history, fixtures are synthetic, `.env.example` has no real values, and **git history has been scrubbed of `backup-data/*.json`** (see the warning at the top of this doc)
- [ ] **Optional, high-leverage:** deploy a live demo (SQLite + a long-running worker rules out serverless — a $5 VPS or the Compose stack on a PaaS) and put the URL in the README

---

## Known landmines

| Landmine | Where | When it bites |
|----------|-------|---------------|
| Two `normalizeFinanceData` definitions, both loaded | `finance.html:414-415` | **Leaves this repo with Phase 1.6** — only `finance.html` loads both scripts, so the investigation and the fix move to `finance-app` |
| ~~Jest `roots` reaches across folders~~ **resolved in Phase 1** | `apps/api/jest.config.cjs:5` → `../../static/js` | — |
| 80% coverage gate on 5 instrumented files | `apps/api/jest.config.cjs:14-30` | Phase 3 — widening before adding tests fails CI. **Phase 1.6 removes 2 of the 5** (`src/financeDb.ts`, `src/services/financeService.ts`), so the gate narrows to 3 files — revisit it there |
| Routes silently absent when DB init throws | `AGENTS.md` known pitfalls | **Resolved by Phases 1.5 + 1.6** — both conditionally-mounted routers are gone, so nothing can silently miss `/api/vocab` or `/api/finance` |
| `lib/` is CJS/ESM mixed and loaded by nothing | `lib/format.js`, `lib/api.js` | Phase 2 — don't assume `lib/` is the good code |
| Global-scope files with no modules | `AGENTS.md` known pitfalls | Phase 5 — removes this constraint file by file |
| ~~Real personal finance data in fixtures~~ **replaced in Phase 1** | `fixtures/*.json` is synthetic | — **history scrubbed after Phase 1**; still needs the force-push and deletion of the stale `copilot/*` branches to finish |
| `migrate:init` does not import `alerts` / `scenarios` | `apps/api/src/services/migration.ts` | Phase 3 — the legacy import drops those two tables *(both are `portfolio.db`, so they stay with this repo)* |
| `pages/sql-explorer.html` exposes arbitrary SQL over HTTP | `apps/api/src/routes/sqlExplorer.ts` | Phase 3 — gate it behind `ENABLE_SQL_EXPLORER` |
| **`VALID_DBS` test hard-codes three database names** | `apps/api/src/routes/sqlExplorer.test.ts:158` | Phase 1.5 (`3` → `2`), then Phase 1.6 (`2` → `1`). Drop the name **and** fix the tuple + length assertion in the same commit, or the suite goes red |
| Docker image asserts the vocabulary page exists | `apps/api/Dockerfile:60` | Phase 1.5 — the healthcheck-style `test -f` fails the build once the page is gone |
| **`dashboard.js` calls `/api/finance/import`** | `static/js/dashboard.js` | Phase 1.6 — the one cross-boundary call; left in place the dashboard POSTs to a route that no longer exists |

---

## Suggested next PRs

**Step 0 (not a PR):** ~~push the scrubbed history~~ **done** - `git push --force origin main` moved `main` to `11b7611`, both stale `copilot/create-sql-query-tool-page*` branches were deleted, and `git ls-remote origin` now shows a single ref (`refs/heads/main`) and no tags. The purge is live on GitHub.

1. ~~**Phase 0** — baseline~~ ✅
2. ~~**Phase 1** — monorepo moves + doc cleanup~~ ✅
3. ~~**Phase 1.5** - delete the vocabulary module (~2,260 lines: page, JS, CSS, 3 backend files, `/api/vocab`, OpenAPI block, third database)~~ **done**
4. **Phase 1.6** — clone out `finance-app` (private, before its first push), then strip Finance from here (~3,750 lines: route, DB shim, service + tests, page, JS, CSS, 2 fixtures, 6 OpenAPI tags)
5. **Phase 2** — `packages/shared` with deduplicated money helpers and their now-honest tests
6. **Phase 3** — backend consolidation (**one** database, gate SQL explorer)
7. **Phase 4** — scaffold `apps/web` and cut the strangler seam
8. **Phase 5** — migrate the 3 remaining pages (analytics → simulation → index)
