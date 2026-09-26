# Modernization Plan

**Target stack:** Vue 3 + TypeScript + Vite · strangler-pattern migration · npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`)

**Invariant:** every phase ends with a running app and a green test suite. One PR per step, conventional commits.

> **Status: Phase 0 and Phase 1 are complete.** This file now lives in `docs/` (the Phase 1 rename). Completed items are checked, with any deviation from the original wording noted in place.

### Decisions made while executing Phases 0–1

- **Baseline artifacts are gitignored, not committed.** `.baseline/` holds `test-baseline.txt` plus 12 screenshots (6 before, 6 after) — they show real net-worth and income figures, so they stay out of git. Phase 5 parity re-runs against them locally.
- **`better-sqlite3` → `^13.0.3` inside Phase 1.** v9 had no prebuild for Node 22, so `npm install` died on `prebuild-install` (no Python/MSVC on this machine). v13 ships prebuilds for win32, linux, **linuxmusl** and darwin, engines `>=22`. This turned the test suite from Docker-only into a native `npm test`, which is what CI and local dev actually want. Dockerfile base went `node:18-alpine` → `node:22-alpine` to match.
- **Root `.npmrc` sets `ignore-scripts=true`.** npm auto-runs `node-gyp rebuild` for any package shipping a `binding.gyp` — i.e. `better-sqlite3` — which fails without a C++ toolchain. Its prebuilds make the build pointless anyway; esbuild resolves its binary from platform-specific optionalDependencies. Side benefit: no dependency can run arbitrary code at install time.
- **`allowScripts` belongs in the root `package.json`** — npm 11 ignores the field when it appears in a workspace manifest (it warns and drops it).
- **`migrate:init` had been dead for a while** and was fixed as part of fixture validation: it INSERTed `trades.profit` (dropped by Drizzle migration `0003`), referenced a `cash_positions` table that was never in the schema, ignored `interestDollarsMonths`, and defaulted USD interest months to `BRL`. Verified end-to-end in an ephemeral container against the new fixture.
- **`scripts/README.md` stays where it is** — it is a folder-local readme for the scripts next to it, not a top-level doc. Deviation from the "move all docs" step.
- **⚠️ Real data is still in git history.** `backup-data/*.json` were tracked across many commits and `git rm` only clears them from HEAD. The GitHub repo returns 404 unauthenticated, i.e. it is **private today**. Before making it public, run `git filter-repo` (or squash to a fresh history) — otherwise every personal finance figure remains downloadable from the old commits.

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
- **Backend:** TypeScript + Express + Drizzle, reasonably layered, but **3 SQLite databases with 3 migration strategies** (`portfolio.db` = Drizzle; `finance.db` / `vocabulary.db` = inline `ALTER TABLE`), conditional route mounting, and a `runF/getF/allF` / `runV/getV/allV` helper-suffix convention.
- **Test coupling:** `apps/api/jest.config.cjs` has `roots: ['<rootDir>/src', '<rootDir>/../static/js']` — reaches across folders. *(repointed in Phase 1)*
- **Coverage:** thresholds enforced at 80%, but `collectCoverageFrom` instruments only 5 files.
- **Repo hygiene:** ~~`backup-data/` holds real personal finance data~~ → replaced by synthetic `fixtures/`; ~~`documentation/DDIA-case-study.md`~~ → moved out of the repo; `openapi.yaml` (42 KB) → `apps/api/openapi.yaml`; no `LICENSE` → added MIT; CI only built a Docker image → `ci.yml` added (lint still deferred to Phase 7); `pages/sql-explorer.html` is an arbitrary-SQL console exposed over HTTP *(still open — Phase 3)*.

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

## Phase 2 — `packages/shared`: contracts + pure domain logic

This is where "logic baked in the frontend" starts dying.

- [ ] **Generate API types from `apps/api/openapi.yaml`** (`openapi-typescript` → `packages/shared/src/generated/api.d.ts`, plus `openapi-fetch` for the client)
- [ ] **Add a contract test** asserting every mounted Express route appears in the spec — prevents drift between 19 route files and the 42 KB spec
- [ ] **`packages/shared/src/domain/money.ts`** — single definition of `formatMoney`, `parseMoney`, `isBRLAsset`, `isBRLNonBond`, `isBRLBond`, BRL⇄USD conversion, total-value math
- [ ] **`packages/shared/src/domain/finance.ts`** — `normalizeFinanceData`, `parseBRNumber`, `formatBRNumber`, `validateData`. **First determine which of the two shadowed definitions is live** before porting
- [ ] **Move `apps/api/src/services/portfolioCalculator.ts` into `packages/shared`** (already pure: "no DB calls, fully testable") and have `apps/api` import it — centerpiece of Phase 6
- [ ] **Delete `lib/`** — `lib/api.js`, `lib/toast.js`, `lib/format.js` are loaded by no page; fold anything worth keeping into `packages/shared`; keep `lib/analytics-insights.js` content (moves in Phase 5)

**Exit:** duplicated helpers have exactly one definition; contract test green.

---

## Phase 3 — Backend consolidation

Do this *before* the Vue work — the frontend needs one predictable API to build against.

- [ ] **One migration strategy:** split `schema.ts` into `schema/portfolio.ts`, `schema/finance.ts`, `schema/vocabulary.ts`; generate Drizzle migrations for all three; retire inline `ALTER TABLE` in `financeDb.ts` / `vocabularyService.ts`; single `npm run db:migrate`
- [ ] **Kill the `runF`/`getF`/`allF` · `runV`/`getV`/`allV` suffix convention** — replace with per-domain repos (`portfolioRepo`, `financeRepo`, `vocabRepo`), each closing over its own connection and exposing `run/get/all`
- [ ] **Stop silently dropping routes:** fail fast in dev; in prod expose module state via `GET /api/health` as `modules: { vocabulary: 'degraded' }`
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

**Order = risk ascending.** One PR per page.

| # | Page | Lines | Why this position |
|---|------|-------|-------------------|
| 1 | `vocabulary-learning` | 118 + 972 JS | Isolated `/api/vocab`, no charts, pure CRUD — proves the pattern cheaply |
| 2 | `analytics` | 190 + 926 | Read-only, consumes `/api/analytics`; `analytics-insights.js` becomes a composable |
| 3 | `simulation` | 190 + 1042 | Duplicate FIFO math → replace with `packages/shared` |
| 4 | `finance` | 390 + 1510 + 170 | Largest CRUD surface; needs the shadowed-function investigation from Phase 2 |
| 5 | `index` (dashboard) | 538 + 2144 | The flagship. Do last, with every pattern proven |

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
| Two `normalizeFinanceData` definitions, both loaded | `finance.html:414-415` | Before porting finance — verify which one is live |
| ~~Jest `roots` reaches across folders~~ **resolved in Phase 1** | `apps/api/jest.config.cjs:5` → `../../static/js` | — |
| 80% coverage gate on 5 instrumented files | `apps/api/jest.config.cjs:14-30` | Phase 3 — widening before adding tests fails CI |
| Routes silently absent when DB init throws | `AGENTS.md` known pitfalls | Phase 7 — Playwright randomly misses `/api/vocab` |
| `lib/` is CJS/ESM mixed and loaded by nothing | `lib/format.js`, `lib/api.js` | Phase 2 — don't assume `lib/` is the good code |
| Global-scope files with no modules | `AGENTS.md` known pitfalls | Phase 5 — removes this constraint file by file |
| ~~Real personal finance data in fixtures~~ **replaced in Phase 1** | `fixtures/*.json` is synthetic | — but the **old data is still in git history** — scrub before publishing |
| `migrate:init` does not import `alerts` / `scenarios` | `apps/api/src/services/migration.ts` | Phase 3 — the legacy import drops those two tables |
| `pages/sql-explorer.html` exposes arbitrary SQL over HTTP | `apps/api/src/routes/sqlExplorer.ts` | Phase 3 — gate it behind `ENABLE_SQL_EXPLORER` |

---

## Suggested next PRs

1. ~~**Phase 0** — baseline~~ ✅
2. ~~**Phase 1** — monorepo moves + doc cleanup~~ ✅
3. **Phase 2** — `packages/shared` with deduplicated money helpers and their now-honest tests
4. **Phase 3** — backend consolidation (one migration strategy, gate SQL explorer)
5. **Phase 4** — scaffold `apps/web` and cut the strangler seam
