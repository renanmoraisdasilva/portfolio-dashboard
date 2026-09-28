# Modernization Plan

**Target stack:** Vue 3 + TypeScript + Vite · strangler-pattern migration · npm-workspaces monorepo (`apps/web`, `apps/api`, `packages/shared`)

**Invariant:** every phase ends with a running app and a green test suite. One PR per step, conventional commits.

> **Status: Phases 0, 1, 1.5 and 1.6 are complete, the real-data purge is live, and the history itself has been squashed to a 13-commit showcase log.** This file now lives in `docs/` (the Phase 1 rename). Completed items are checked, with any deviation from the original wording noted in place. Remaining work: the Phase 1.6 data cutover below, then Phases 2–8.
>
> **Line numbers in this document are historical.** They record where things lived when each phase ran — before the Phase 2 `lib/` deletion and the Phase 3 comment cut — so treat them as pointers to the pre-cut tree, not current positions.

### Decisions made while executing Phases 0–1

- **Baseline artifacts are gitignored, not committed.** `.baseline/` holds `test-baseline.txt` plus 12 screenshots (6 before, 6 after) — they show real net-worth and income figures, so they stay out of git. Phase 5 parity re-runs against them locally.
- **`better-sqlite3` → `^13.0.3` inside Phase 1.** v9 had no prebuild for Node 22, so `npm install` died on `prebuild-install` (no Python/MSVC on this machine). v13 ships prebuilds for win32, linux, **linuxmusl** and darwin, engines `>=22`. This turned the test suite from Docker-only into a native `npm test`, which is what CI and local dev actually want. Dockerfile base went `node:18-alpine` → `node:22-alpine` to match.
- **Root `.npmrc` sets `ignore-scripts=true`.** npm auto-runs `node-gyp rebuild` for any package shipping a `binding.gyp` — i.e. `better-sqlite3` — which fails without a C++ toolchain. Its prebuilds make the build pointless anyway; esbuild resolves its binary from platform-specific optionalDependencies. Side benefit: no dependency can run arbitrary code at install time.
- **`allowScripts` belongs in the root `package.json`** — npm 11 ignores the field when it appears in a workspace manifest (it warns and drops it).
- **`migrate:init` had been dead for a while** and was fixed as part of fixture validation: it INSERTed `trades.profit` (dropped by Drizzle migration `0003`), referenced a `cash_positions` table that was never in the schema, ignored `interestDollarsMonths`, and defaulted USD interest months to `BRL`. Verified end-to-end in an ephemeral container against the new fixture.
- **`scripts/README.md` stays where it is** — it is a folder-local readme for the scripts next to it, not a top-level doc. Deviation from the "move all docs" step.
- **The vocabulary module is being deleted, not migrated** (decision recorded after Phase 1). It is unused and will not be used, so instead of porting it to Vue it is removed outright — see **Phase 1.5**. That takes the app from three SQLite databases down to two and drops one of the five pages from the Phase 5 migration order.
- **Finance moves to its own private repository** (decision recorded after Phase 1). This repo is going public as a portfolio showcase, so the genuinely personal material — income, fixed and eventual expenses, credit-card balances, tithes, multi-year records — has to live somewhere GitHub-private. A repository has exactly **one** visibility flag, so a workspace folder inside this monorepo *cannot* be private: Finance gets its own repo and its own `finance.db`. This repo keeps only portfolio — dashboard + asset charts, simulation, analytics. See **Phase 1.6**.
- **✅ Real data purged from git history** (done after Phase 1). `backup-data/**`, the root-level `portfolio_data.json` and `hist.json` were stripped from **every commit reachable from all refs**, so those paths never existed at any point in history. Messages, authors and dates were preserved (a GPG signature cannot survive a rewrite), `npm run check` stayed green, and the resulting tree was byte-identical to the pre-rewrite tree. The purge was **force-pushed**, the two stale `copilot/create-sql-query-tool-page*` branches were deleted server-side, and `git ls-remote origin` shows a single ref (`refs/heads/main`) and no tags. **The log has since been squashed a second time** — the whole pre-modernization era now collapses to one import commit, so the full history reads as 13 commits instead of 134. Recovery handle: the **local-only** `pre-modernization` tag still points into the pre-squash history; never `git push --tags`.
- **✅ Comment volume cut ~88%** (done in Phase 3). 1,123 comment lines across 59 files became 137. The keep-list is the ~11% that carries a non-obvious WHY — domain rules (BRL non-bond vs bond), invariants (idempotency, optimistic-update, dedup guards), constraints (container layout mirroring, load order) and the security rationale for the SQL Explorer gate. Everything else — banners, section headers, doc comments that repeat the identifier, test arithmetic — went. Removal is parser-based (TypeScript compiler for `.ts`/`.js`, string-aware scanners for HTML/CSS), so regex literals, template literals and strings containing `//` are untouched; the result is verified by re-compiling every changed file with `removeComments` and diffing, plus `npm run check`.

---

## Baseline findings (recorded at Phase 0)

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
- **Backend:** TypeScript + Express + Drizzle, reasonably layered, but ~~**3 SQLite databases with 3 migration strategies**~~ -> **one database since Phase 1.6** (`portfolio.db`, Drizzle-managed), ~~conditional route mounting~~ -> `web.ts` has no try/catch-gated routes left at all, and ~~a `runF/getF/allF` / `runV/getV/allV` helper-suffix convention~~ -> only `run()`/`get()`/`all()` from `db.ts` remain.
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

**Why a separate repository and not a workspace:** this repo is going public as a showcase. Finance holds the personal surface — income, fixed and eventual expenses, credit-card balances (`nuRenan` / `nuJu` / `nomad`), tithes, multi-year records — and GitHub gives a repository exactly **one** visibility flag. A folder inside a public monorepo cannot be private, so Finance must be its **own private repository** with its own `finance.db`.

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

### Data cutover — the only part that can lose data

Deploying new code cannot lose the databases, by construction. They are gitignored (`apps/api/data/*.db`), dockerignored (`apps/api/data`), and bind-mounted from the host:

```yaml
# docker-compose.yml — production
volumes:
  - /opt/portfolio/data:/app/apps/api/data
```

A deploy pulls a new GHCR image and recreates the containers; `/opt/portfolio/data` is a directory **on the host** that the container merely mounts. Nightly backups (`server-infra` `backup-databases.sh.j2`, 02:15) run `sqlite3 .backup` + `PRAGMA integrity_check` over that directory into `/mnt/media/backups/luna/<stamp>/`, and `server-infra/docs/recovery.md` step 6 restores it.

So there is no export/import and no "apply later" — with one exception:

| Database | Fate across the split |
|---|---|
| `portfolio.db` | stays in `/opt/portfolio/data`; mount and backups unchanged — **no action** |
| `finance.db` | moves to the Finance app's own data dir — **must be relocated by hand** |
| `vocabulary.db` | already dead (Phase 1.5); file left in place, harmless |

The failure mode to design against: `initFinanceDB()` creates every table on first run. Deploy Finance without its file and it comes up **green** — `/api/health` ok, correct schema, every balance zero. No error, no crash, no log line. This is therefore a *file relocation*, not a migration of rows.

- [ ] **Manual backup before the cutover** — the nightly job is a safety net, not a rehearsal
- [ ] **Deploy the portfolio half first** — `portfolio.db` and its mount are untouched, so this is safe standing alone; finance data just sits in its file until the relocation step
- [ ] **Relocate `finance.db`** - stop both containers, **move** (not copy) `/opt/portfolio/data/finance.db` -> `/opt/finance/data/finance.db` (the path `finance-app/docker-compose.yml` already mounts - create the directory first), start, then spot-check row counts in each app against the backup taken above
- [x] **Close the backup gap** — ✅ **done in `server-infra`** (separate repo, as planned): `backup-databases.sh.j2` now takes `backup_finance_data_dir` alongside `backup_portfolio_data_dir`, loops over exactly `portfolio.db` + `finance.db` (no more `vocabulary.db`), and **hard-fails if either file is missing** instead of skipping silently. `docs/recovery.md` step 6 now restores `finance.db` into `/opt/finance/data` and warns against putting it back under `/opt/portfolio/data`.

### Building it

- [x] **Seed the repo first:** clone this repository out to `finance-app` **before** deleting anything here, so Finance inherits the already-scrubbed history. **Create it locally only** — the owner publishes it to GitHub and sets it **private before the first push**. Then delete the portfolio half from `finance-app` and the Finance half from here
- [x] **Sever the single cross-boundary call:** `dashboard.js` calls **`/api/finance/import`** — remove that action and its Settings UI from the portfolio dashboard (or port it into the Finance app). Do not leave a dead button behind
- [x] **Confirm the seam is genuinely closed:** `routes/state.ts` already has zero `finance`/`getF`/`runF`/`allF` references, i.e. `GET /api/state` export/import touches `portfolio.db` only — re-verify after the split so no finance section leaks into the state export
- [x] **Coverage config:** `apps/api/jest.config.cjs` `collectCoverageFrom` instruments exactly 5 files, two of which are `src/financeDb.ts` and `src/services/financeService.ts`. Remove them and re-check the 80% gate — it will now rest on 3 files
- [x] **SQL explorer:** drop `'finance'` from `VALID_DBS` → `['portfolio']` alone, and update `sqlExplorer.test.ts:156-164` in the **same commit** (it asserts both the exact tuple and the length: `3` after Phase 1.5 → `1` here)
- [x] **Conditional mounting ends:** `finance` is the *other* conditionally-mounted router. With vocabulary gone (1.5) and finance gone (here), `web.ts` has no try/catch-gated routes left — the "silently absent routes" pitfall in `AGENTS.md` and the `/api/health` `modules:` item in Phase 3 both disappear
- [x] **Docs:** `AGENTS.md` — the *Finance module* section, the `financeDb.ts` row in the backend layout, the `runF/getF/allF` bullet, the *Schema migrations* paragraph about `finance.db`, the `routes/finance.ts` row in the route table, the conditionally-mounted-routes pitfall, and the `finance.js` entry in the plain-scripts pitfall. Same sweep for `docs/ARCHITECTURE-OVERVIEW.md` and `README.md`
- [x] **Exit check:** `grep -riE 'api/finance|financeDb|financeService'` returns nothing in this repo; `npm run check` green; stack healthy on **one** database (`portfolio.db`); all remaining pages load **Met:** `git grep -E "api/finance|financeDb|financeService"` now returns nothing outside this plan file; `npm run check` green (12 suites / 335 tests, 80% gate holding on 3 instrumented files); a fresh instance serves all 14 live routes at 200 while `/api/finance*`, `/api/finance/import` and `/pages/finance.html` are 404, and it does **not** recreate `finance.db`. *(deviation: the Compose rebuild stays deferred to Phase 5, same as Phase 1.5 — the running Docker stack still serves the pre-split build.)*

**Exit:** this repo = portfolio only (dashboard + asset charts, simulation, analytics), one database, no personal-finance surface anywhere; `finance-app` private and running on its own DB. *(code side done; `finance-app` exists locally with the scrubbed history and no remote.)*

---

## Phase 2 — `packages/shared`: contracts + pure domain logic

This is where "logic baked in the frontend" starts dying.

**How the package is consumed:** `packages/shared` builds to `dist/` (`main`/`types` point there), the root `build`, `typecheck` and `dev` scripts build it first, and Jest maps the package name to its source so the suite never needs a build step. Chosen over TS path mapping because `apps/api` compiles with `rootDir: src`, which cannot emit files outside `src`. The Docker image copies `packages/shared` into the runtime stage, since npm workspaces only symlink it into `node_modules`.

- [x] **Generate API types from `apps/api/openapi.yaml`** (`openapi-typescript` → `packages/shared/src/generated/api.ts`, plus `openapi-fetch` for the client) — **done** via the root script `npm run api:types`, which emits 1,841 lines of `paths` / `components` / `operations` types, verified with `tsc --strict --skipLibCheck false`; `packages/shared/src/index.ts` re-exports them, so the package `main`/`types` no longer dangle. *(deviations: `openapi-fetch` is **not** installed — there is no client to wire it to until `apps/web` exists in Phase 4, so it lands with the shell; and the generated file is **committed** rather than gitignored, so consumers never need a generation step first)*
- [x] **Add a contract test** asserting every mounted Express route appears in the spec — prevents drift between the 14 route modules and the spec. **Done first, ahead of the `openapi-typescript` step above** *(deviation: validate the spec before anything is generated from it)* — `apps/api/src/openapi.contract.test.ts` builds the real app with `createApp()` + `mountWebRoutes()`, walks the mounted Express router stack, and compares method + path against `apps/api/openapi.yaml` in **both** directions (`:id` and `{id}` normalized to `{param}`). It immediately found **14 undocumented operations**: three routers that had no entry and no tag at all (`analytics`, `migrations`, `sql`), plus `GET /trades`, the `/cash/entries` trio, `/history/ohlc`, `/history/fill-gaps` and `/asset/{symbol}/ohlc`. All documented now — the spec grew 760 → 1,208 lines (18 KB → 32 KB).
- [x] **`packages/shared/src/domain/money.ts`** — single definition of `formatMoney`, `parseMoney`, `isBRLAsset`, `isBRLNonBond`, `isBRLBond`, BRL⇄USD conversion. The symbol-dependent predicates are bound to a registry through `createSymbolClassifier(symbols)` — the API binds `src/config/symbols.ts`, the pages bind `/api/config/symbols` — so both sides run the same code; `portfolioCalculator.ts` now delegates its `isBRLNonBond` and its BRL→USD conversions to it, and `__tests__/brl-usd-calculations.test.js` imports the real helpers instead of its private copies. *(deviations: the compute* family — `computeTotalUSD` and friends — stays a test-local mirror until Phase 5 rewrites the pages, because plain scripts cannot import the package; `lib/format.js` was deleted below in favour of the shared helpers; and the generated API types are `src/generated/api.ts` rather than `.d.ts`, so `tsc` emits them into `dist/` — a bare `.d.ts` is not copied and the built package's re-export would dangle)*
- [x] **`packages/shared/src/domain/finance.ts`** *(closed after the Phase 1.6 split — grep finds no caller for any of these helpers anywhere in `static/`)* — `normalizeFinanceData`, `parseBRNumber`, `formatBRNumber`, `validateData`. **Phase 1.6 took this file out of the repo**: `normalizeFinanceData` is defined only in `finance.js` / `finance-utils.js`, which only `finance.html` loads, and no other page imports `finance-utils.js`. Port it here **only** if a portfolio page actually needs a BR-number helper — otherwise both this bullet and the shadowed-definition landmine leave with Finance
- [x] **Move `apps/api/src/services/portfolioCalculator.ts` into `packages/shared`** (already pure: "no DB calls, fully testable") and have `apps/api` import it — centerpiece of Phase 6. **Done** as `packages/shared/src/domain/portfolio.ts` behind `createPortfolioCalculator(symbols)`: the calculator is bound to a symbol registry, so `apps/api` keeps a thin `src/services/portfolioCalculator.ts` that binds `src/config/symbols.ts` and re-exports `isBRLNonBond` / `replayFIFOLots` / `computePortfolioValue` — `analyticsService`, `cashBackfill` and `historyManager` are untouched. Its unit tests moved with it to `packages/shared/src/domain/portfolio.test.ts`, so Jest `roots` now includes `packages/shared/src`.
- [x] **Delete `lib/`** — `lib/api.js`, `lib/toast.js`, `lib/format.js` are loaded by no page; fold anything worth keeping into `packages/shared`; keep `lib/analytics-insights.js` content (moves in Phase 5). **Done**: the three files are gone (verified — no page references them), `format.test.js` now tests the shared `formatMoney` / `parseMoney`, and `lib/` holds only `analytics-insights.js` until Phase 5.

**Exit:** duplicated helpers have exactly one definition; contract test green. *(partially met — see the deviations on the `money.ts` and `lib/` bullets: the browser copies and the compute* mirrors leave with Phase 5)*

---

## Phase 3 — Backend consolidation

Do this *before* the Vue work — the frontend needs one predictable API to build against.

- [x] **One migration strategy — done (Phase 3).** One database, one mechanism: `schema.ts` → Drizzle migrations, applied by `init()` on boot or on demand via the new `npm run db:migrate` (`apps/api/src/dbMigrate.ts`; dev/CI only, since the runtime image prunes devDependencies). `migrate:init` is explicitly *not* a schema migration — it imports the JSON fixture, and `AGENTS.md` now says so. *Correction to the original wording:* there **are** two inline `ALTER TABLE` calls left in `db.ts` (`cash_entries` → `cash`, `interest_months` → `interest`). They are the pre-Drizzle upgrade path — guarded by a "has `trades` but no `__drizzle_migrations`" check and idempotent — so they are kept rather than reconciled; every database created since Drizzle adoption goes through the migration files. Original wording:** it collapses to *the* strategy — `schema.ts` stays the single source of truth for `portfolio.db` and `npm run db:migrate` is the only migration command. **Phases 1.5 and 1.6 removed the other two databases**, so there is no `schema/vocabulary.ts`, no `schema/finance.ts`, no inline `ALTER TABLE` and no `financeDb.ts` init left to reconcile — the "3 databases with 3 migration strategies" finding is simply gone
- [x] **Kill the `runF`/`getF`/`allF` suffix convention — verified gone (Phase 3).** There was nothing left to kill: `git grep -E "\b(run|get|all)(F|V)\b"` over `apps/api/src` returns nothing, and `db.ts` is the only database module in the repo. *Correction to the original wording:* the suggested per-domain repos (`portfolioRepo`, `analyticsRepo`, …) are obsolete now that there is one database — there is a single connection to close over, so wrapping `run`/`get`/`all` in per-domain objects would be a rename with no behavioural change. Original wording: — replace with per-domain repos (`portfolioRepo`, `analyticsRepo`, …) closing over their own connection and exposing `run/get/all`. *(`runV/getV/allV` left with Phase 1.5, `runF/getF/allF` left with Phase 1.6 — so only `run`/`get`/`all` remain, and the suffix convention itself can go)*
- [x] **Stop silently dropping routes — done (Phase 3).** DB init already exits 1 in `web.ts`/`worker.ts`/`index.ts` and the `modules:` list is already gone; the last hole was `/api/health` answering `ok: true` with nulled fields when its DB read threw, which now returns `503` with `{ ok: false, error }` — the same signal the compose/Docker healthcheck keys on, so a broken database marks the container unhealthy instead of green. Covered by `apps/api/src/routes/health.test.ts`; the spec documents the 503 with `HealthStatus` / `HealthFailure`. Original wording: with both conditionally-mounted routers gone there is nothing left to swallow, so make DB init **fail fast** everywhere and delete the try/catch-gated mounting pattern; `/api/health` no longer needs a `modules: { …: 'degraded' }` list
- [x] **Retire or justify `routes/state.ts` — decided: delete in Phase 5.** It stays as the legacy aggregation endpoint for the three vanilla pages (which still need one-shot state on load), and comes out once the migrated Vue views read granular endpoints instead. *Not* redefining it as a BFF: the Vue app is built on the typed, granular `/api/*` surface, so a second aggregate endpoint would be a second contract to keep in sync. The deletion itself is tracked in the Phase 5 per-page checklist, not here. — documented as "legacy aggregation"; either define it as the dashboard's BFF endpoint or delete once Vue consumes granular endpoints
- [x] **Gate `sql-explorer`** behind `ENABLE_SQL_EXPLORER=true`, off by default in the Docker image — don't ship an open SQL endpoint. **Done**: `app.ts` mounts a 403 guard in front of `/api/sql` unless the flag is `true`; `apps/api/src/sqlExplorer.gate.test.ts` covers both states, the Dockerfile documents why the flag is unset, and the spec description plus `docs/README-backend.md` state the default. *(deviation: the routes are still mounted — they answer 403 rather than 404 — so the OpenAPI contract test keeps seeing them and the spec keeps documenting them; the guard is the security boundary)*
- [x] **Widen coverage — done (Phase 3).** The gate rested on a single file; it now spans seven: `config/symbols.ts`, `schema.ts`, `routes/health.ts`, `services/cashBackfill.ts`, `services/portfolioCalculator.ts` and `packages/shared/src/domain/{money,portfolio}.ts` — **100% statements, lines and functions, 98.4% branches** against the 80% gate. Two moves made that possible: Jest's `rootDir` moved to the repo root (the babel coverage provider only instruments files under `rootDir`, which is exactly why `packages/shared` was previously unmeasured), and three tests were written *first* so the widened list never dipped below the gate — `cashBackfill`'s fully-sold position and zero-rate branches, `parseMoney`'s whitespace-only and separator-only inputs. Still uncovered and deliberately out of scope: the routers (`state` 12%, `asset` 13%, `trades` 16%, `cash` 20%, `migrations` 10%), the job modules, and the three large services (`analyticsService` 55%, `historyManager` 46%, `priceFetcher` 32%) — each needs integration-style tests before it can join the list. Original wording: beyond 5 files — add tests first, widen `collectCoverageFrom` second, then keep the 80% gate honest

**Exit:** one migration command, routes fail loudly, SQL explorer off by default.

---

## Phase 4 — Strangler seam: scaffold `apps/web`

- [x] `apps/web`: Vite + Vue 3 + TS + `vue-router` + `pinia` + `chart.js` + `lightweight-charts` — **done**: scaffolded with `index.html`, `vite.config.ts`, a strict `tsconfig.json` and `src/{main.ts, App.vue, env.d.ts}`. `npm run build:web` type-checks with `vue-tsc` and bundles to `apps/web/dist`, and the root `build` now includes it so CI covers it. Versions are current but chosen for API stability over newest: `lightweight-charts@4` (what the pages load from CDN today) rather than 5, `vue-router@4` rather than 5, and `typescript@5.9` to match `apps/api` rather than adding a second TypeScript to the workspace. Original wording: — both already used via CDN `<script>` tags, so moving to npm deps removes them
- [x] Vite dev proxy `/api` → `:3000` — **done** in `apps/web/vite.config.ts`, with the target overridable through `API_URL`; verified by fetching `/api/health` through the dev server on `:5173`
- [x] **The strangler seam — done (Phase 4), except the router side.** Express now serves `apps/web/dist` at `/` with a SPA fallback and mounts `pages/` at **`/legacy/`**; the vanilla pages' 14 internal links were repointed at `/legacy/…`, and `/pages/x.html` plus `/x.html` still redirect there so old bookmarks keep working. `apps/api/src/seam.test.ts` covers the routing, and the Dockerfile builds and ships `apps/web/dist`. Two consequences worth recording: the static root is no longer the repository (the old `express.static(repoRoot)` served `node_modules/` and `.git/`), and CI now builds before testing so the seam test can assert against a real bundle. Original wording: Express serves `apps/web/dist` at `/` and mounts `pages/` at **`/legacy/`**; Vue router renders migrated routes and redirects unmigrated ones to `/legacy/<page>` — progress is visible in the router table
- [x] Build the shell only — **done**: `App.vue` + `components/AppNav.vue` reuse the `layout.css` classes the legacy pages already use, `index.html` links `base.css` / `components.css` / `layout.css` from the API's static mount (Vite proxies `/static` in dev), `config/nav.ts` *is* the migration table, `composables/useApi.ts` is an `openapi-fetch` client typed from the generated `paths`, and unmigrated routes render `views/LegacyHandoff.vue`. `pinia` stays unwired until Phase 5 adds the first store. *(deviation: unmigrated routes **hand off** with a visible link to `/legacy/<page>` rather than redirecting automatically — an instant bounce would hide the shell and make the migration invisible, the opposite of "progress is visible in the router table"; say the word and it becomes a redirect instead.)*

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
- [ ] Move pure logic → `packages/shared`, **importing the real functions** — ~~specifically fix `__tests__/brl-usd-calculations.test.js`, which currently tests a copy defined inside the test file~~ *(done in Phase 2: it now imports the real helpers; what remains is moving the compute* mirrors into `packages/shared`)*
- [ ] Build components: `views/` + `components/{charts,tables,forms,overlays}` + `composables/` (`useMoney`, `useCurrency`, `useApi`)
- [ ] Parity: screenshot vs. Phase 0, same numbers on the golden fixture, `k6 run scripts/k6/dashboard-workflow.js` still under 1% failures / p95 < 500 ms
- [ ] **Delete the old JS file and its `<script>` tag**, flip the router redirect to the Vue view — nothing deleted before parity passes
- [ ] After the **last** page migrates: delete `apps/api/src/routes/state.ts` and `GET /api/export` — the Vue views read granular endpoints, so the aggregation endpoint has no consumers left (Phase 3 decision)

**Exit per page:** old file gone, route renders Vue, parity documented in the PR.

---

## Phase 6 — Push logic out of the browser

- [ ] **FIFO lot math out of the client** — `simulation.js` `buildLotsFromTradesCombined()` / `computePortfolioFromCombined()` become a `/api/simulate` call *or* an import of the shared module both API and web use; the point is one implementation
- [ ] **Server owns derived values** — portfolio totals, invested cost, BRL conversion. The browser renders, it doesn't compute
- [ ] **Give the API client a typed error contract** — the old `lib/api.js` `null`-on-error wrapper left with the Phase 2 `lib/` deletion; build the typed client (throws `ApiError`) together with `apps/web` in Phase 4
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
| ~~Two `normalizeFinanceData` definitions, both loaded~~ **left with Phase 1.6** | `finance.html` → `finance-app` | — |
| ~~Jest `roots` reaches across folders~~ **resolved in Phase 1** | `apps/api/jest.config.cjs:5` → `../../static/js` | — |
| ~~80% coverage gate on 5 instrumented files~~ **resolved in Phase 3** | `apps/api/jest.config.cjs` — the gate now spans 7 files | — **rootDir moved to the repo root and tests were added before the list was widened**, so the 80% threshold never tripped |
| Routes silently absent when DB init throws | `AGENTS.md` known pitfalls | **Resolved by Phases 1.5 + 1.6** — both conditionally-mounted routers are gone, so nothing can silently miss `/api/vocab` or `/api/finance` |
| ~~`lib/` is CJS/ESM mixed and loaded by nothing~~ **resolved in Phase 2** | `lib/api.js`, `lib/toast.js`, `lib/format.js` deleted; `lib/` keeps only `analytics-insights.js` | — |
| Global-scope files with no modules | `AGENTS.md` known pitfalls | Phase 5 — removes this constraint file by file |
| ~~Real personal finance data in fixtures~~ **replaced in Phase 1** | `fixtures/*.json` is synthetic | — **history scrubbed and force-pushed, then squashed**; the `copilot/*` branches are gone |
| `migrate:init` does not import `alerts` / `scenarios` | `apps/api/src/services/migration.ts` | Phase 3 — the legacy import drops those two tables *(both are `portfolio.db`, so they stay with this repo)* |
| ~~`pages/sql-explorer.html` exposes arbitrary SQL over HTTP~~ **resolved in Phase 3** | `apps/api/src/app.ts` → 403 guard on `/api/sql` unless `ENABLE_SQL_EXPLORER=true` | — |
| ~~**`VALID_DBS` test hard-codes three database names**~~ **resolved in Phases 1.5 + 1.6** | `sqlExplorer.test.ts` → `['portfolio']` alone | — |
| ~~Docker image asserts the vocabulary page exists~~ **resolved in Phase 1.5** | `apps/api/Dockerfile` | — |
| ~~**`dashboard.js` calls `/api/finance/import`**~~ **resolved in Phase 1.6** | `static/js/dashboard.js` | — |

---

## Suggested next PRs

**Step 0 (not a PR):** ~~push the scrubbed history~~ **done** — the purge was `git push --force`d to `main`, both stale `copilot/create-sql-query-tool-page*` branches were deleted, and `git ls-remote origin` shows a single ref (`refs/heads/main`) with no tags. The log was then **squashed**: `main` now runs from a single import commit to the current tip in 13 commits. The purge is live on GitHub. *(This step no longer names a SHA — every pre-squash SHA is reachable only from the local `pre-modernization` tag.)*

1. ~~**Phase 0** — baseline~~ ✅
2. ~~**Phase 1** — monorepo moves + doc cleanup~~ ✅
3. ~~**Phase 1.5** - delete the vocabulary module (~2,260 lines: page, JS, CSS, 3 backend files, `/api/vocab`, OpenAPI block, third database)~~ **done**
4. ~~**Phase 1.6** - clone out `finance-app` (private, before its first push), then strip Finance from here (~3,750 lines: route, DB shim, service + tests, page, JS, CSS, 2 fixtures, 6 OpenAPI tags)~~ **done**
5. **Phase 2** — `packages/shared` with deduplicated money helpers and their now-honest tests
6. **Phase 3** — backend consolidation (**one** database, gate SQL explorer)
7. **Phase 4** — scaffold `apps/web` and cut the strangler seam
8. **Phase 5** — migrate the 3 remaining pages (analytics → simulation → index)
