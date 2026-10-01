# Getting Started

How to run, build, test and deploy Portfolio Dashboard. The [README](../README.md)
is the front door and explains what the project _is_; this document is the
operating manual.

---

## Requirements

- **Node 22** — the CI matrix pins it, and `apps/api/tsconfig.json` needs the
  Node 22 globals.
- **npm 10+**, which ships with Node 22 and is what the workspaces rely on.
- **Docker**, only if you want the containerised path. Everything else runs
  directly on Node.
- No database server. `portfolio.db` is a SQLite file and is created on first run.

There is nothing else to install and no service to provision. That is the
consequence of the [SQLite decision](ARCHITECTURE-OVERVIEW.md), and it is why
this project clones and runs.

---

## Run it locally

```bash
git clone https://github.com/<you>/portfolio-dashboard.git
cd portfolio-dashboard
npm install
npm run seed:local        # import the synthetic fixture into an empty database
npm run dev               # http://localhost:3000
```

Migrations run automatically on first start, so `npm run seed:local` is optional.
Without it you get an empty portfolio and the pages render their empty states —
which is a legitimate way to look at the app, just not the interesting one.

### Two processes, one database

`npm run dev` starts **only the web process**. The worker is a separate entry
point:

```bash
npm run start:worker
```

They are independent by design. The web process serves HTTP; the worker runs the
scheduled jobs (price refresh every 8 minutes, a portfolio snapshot every 30
minutes, analytics once a day). Running the worker while you are editing means
snapshots land in your development database from prices you did not ask for, so
it is kept out of `npm run dev` on purpose.

Both processes open the same SQLite file, and `db.ts` sets `journal_mode = WAL`.
One writer at a time is the whole concurrency model, which is sufficient for a
single user and is the ceiling discussed in the README.

> **Never start a server against `apps/api/data/` while testing.** Set
> `PORTFOLIO_DATA_DIR` to a throwaway directory. A hand-started
> `node apps/api/dist/web.js` without it opens the real database.

### Frontend development with hot reload

```bash
npm run dev:web           # http://localhost:5173
```

Vite proxies `/api` and `/static` to `:3000`, so run the API alongside it. This
is the loop the Vue pages were written in: `vue-tsc` type-checks on build, and
the store tests run in jsdom against a stubbed API client.

---

## Tech stack

| Layer     | Choice                                                      | Why                                                                                                                                           |
| --------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | Vue 3 (Composition API, `<script setup>`), TypeScript, Vite | Three pages, a 400-line store each; the migration was done by strangler pattern so the app was never broken mid-move                          |
| Charts    | Chart.js, lightweight-charts                                | Doughnut and line charts, plus candlesticks for the per-asset views                                                                           |
| Backend   | Node 22, Express 4, TypeScript                              | Small, boring, and the whole API is 14 route modules                                                                                          |
| Database  | SQLite via Drizzle ORM                                      | One file, one writer, no server to operate — appropriate for a single-user app                                                                |
| Contracts | OpenAPI 3 → generated TypeScript                            | `npm run api:types` regenerates `paths`; a route that drifts from the spec fails the contract test, and a payload that drifts fails `vue-tsc` |
| Tests     | Vitest (unit + jsdom), Playwright (browser)                 | One runner for API, web and shared; six smoke tests that drive the built bundle                                                               |
| Quality   | ESLint 9 flat config, Prettier, five-job CI                 | A PR cannot merge with an unused import, an unformatted file or a red image                                                                   |
| Telemetry | OpenTelemetry → SigNoz                                      | Request spans on the existing endpoints; no vendor lock-in in the code                                                                        |

---

## Commands

| Command                                 | What it does                                           |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run dev`                           | API with hot reload, on `:3000`                        |
| `npm run start:worker`                  | the worker process on its own                          |
| `npm run dev:web`                       | Vite dev server, on `:5173`                            |
| `npm run build`                         | shared → API → web                                     |
| `npm test`                              | Vitest across all three workspaces (427 tests)         |
| `npm run test:coverage`                 | …with coverage against the 80% gate                    |
| `npm run test:e2e`                      | Playwright smoke tests (needs a build first)           |
| `npm run lint` / `npm run format:check` | ESLint and Prettier                                    |
| `npm run check`                         | everything CI verifies, in one command                 |
| `npm run scan:secrets`                  | asserts no data or credential ever entered git history |
| `npm run audit`                         | dependency audit — currently 0 vulnerabilities         |
| `npm run api:types`                     | regenerate the typed client from `openapi.yaml`        |
| `npm run db:generate`                   | generate a Drizzle migration after editing `schema.ts` |
| `npm run db:migrate`                    | apply pending migrations without starting the server   |
| `npm run db:studio`                     | open Drizzle Studio against the local database         |
| `npm run demo:build`                    | regenerate `docs/dashboard-demo.gif` from the real app |
| `npm run demo:stills`                   | regenerate the README screenshots in `docs/images/`    |

`npm run check` is what CI runs: `lint → format:check → build → test`.

### The demo media

`docs/dashboard-demo.gif` and `docs/images/*.webp` are committed documentation
artifacts, not build output. Both are produced by
`scripts/build-demo-gif.mjs`, which boots the built server against a temporary
database seeded from the fixture, synthesises a deterministic price cache, and
drives the real pages with Playwright. Nothing is hand-drawn, so a screenshot
cannot drift from the product.

The stills are **lossless** WebP. Playwright's own WebP output is lossy, and these
pages are dark UI with 1px chart gridlines and small grey text on navy, which is
what compression damages first — so the script captures PNG in memory and
re-encodes with `sharp`. Lossy `q85` measured 62% smaller than PNG but visibly
thinned the gridlines; lossless is 34% smaller and decodes to exactly the pixels
that were on screen.

Prices are synthesised rather than fetched, because `price_cache` is a cache of
live quotes and the fixture cannot supply one — without it every position is
worth zero, which is correct behaviour and a terrible demo. The drift is a fixed
per-symbol constant, so regenerating produces the same numbers and a reviewer
can check the arithmetic. See the script's header comment.

They are **not** rebuilt in CI: that would put a binary diff in every commit.

---

## The API

`apps/api/openapi.yaml` is the contract, and Swagger UI is at `/api/docs`.

```bash
npm run api:types         # regenerate packages/shared/src/generated/api.ts
```

`apps/api/src/openapi.contract.test.ts` asserts that every mounted Express route
appears in the spec, so an endpoint added without documenting it fails the build.

Three things to know before you build on it:

- **`GET /api/portfolio/valuation?cash=with-cash|investments` is the one to read
  first.** It returns totals, invested cost, realized and unrealized P/L, one row
  per position and per cash balance, and the allocation split — all computed
  server-side, with each amount stating the currency it is in. The browser does
  not do this arithmetic; the simulator is the single deliberate exception,
  because its prices are hypothetical and change on every keystroke.
- **A trade creates a matching cash entry**, and the trade row carries that
  entry's id, so the cash ledger and the trade list cannot disagree and deleting
  a trade reverses the movement. This is the one place where "the database has
  two views of the same fact" is prevented structurally rather than by
  convention.
- **Nothing in the app runs arbitrary SQL.** To inspect the database, run
  `npm run db:studio` — it opens the SQLite file in Drizzle Studio and binds no
  port, which is the opposite of an HTTP endpoint that executes whatever it is
  sent.

More in [BACKEND.md](BACKEND.md).

---

## Backup and restore

`GET /api/state/export` is the only backup, and `POST /api/state/import` is a
true replace: every table the payload carries is cleared before it is written, so
restoring an older backup can undo a later mistake. An absent key leaves its
table untouched, so a partial payload cannot empty a table.

The export carries every table that cannot be re-derived — trades, snapshots,
interest, cash, alerts, scenarios and the three caches — and excludes
`price_ticks`, which is refetched from Yahoo and is 28 MB of the file. Including
it would exceed the body limit the import accepts, so the app could no longer
restore its own backup. It also excludes `__drizzle_migrations`, so a restore
cannot claim a migration history it does not have.

> The database runs in **WAL mode**, so copying `portfolio.db` by hand captures
> a stale state — recent writes live in `portfolio.db-wal` until a checkpoint,
> which can be weeks away. Use the export endpoint or SQLite's `backup()` API.

---

## Docker

With sample data included:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

For the production host — Ubuntu, Docker and Dokploy — see
[SERVER-SETUP.md](SERVER-SETUP.md). Alert notifications are covered by
[HOME_ASSISTANT_SETUP.md](HOME_ASSISTANT_SETUP.md).

---

## Where things live

| Path                          | What it holds                                                         |
| ----------------------------- | --------------------------------------------------------------------- |
| `apps/api/src/routes/`        | the 14 Express route modules                                          |
| `apps/api/src/services/`      | price fetching, snapshot history, analytics, Home Assistant           |
| `apps/api/src/jobs/`          | the worker's three scheduled jobs                                     |
| `apps/api/src/schema.ts`      | the Drizzle schema — single source of truth for `portfolio.db`        |
| `apps/web/src/views/`         | the three Vue pages                                                   |
| `apps/web/src/stores/`        | one Pinia store per page                                              |
| `packages/shared/src/domain/` | the money helpers, the FIFO lot walk and `computeValuation`           |
| `docs/images/`                | README screenshots (lossless WebP), produced by `npm run demo:stills` |
| `fixtures/`                   | the synthetic dataset — no real portfolio data, ever                  |

Read [AGENTS.md](../AGENTS.md) before changing anything. It carries the
conventions and, more importantly, the list of defects that are deliberate or
easy to reintroduce.

---

## Next

- [ARCHITECTURE-OVERVIEW.md](ARCHITECTURE-OVERVIEW.md) — schema, caching, the
  two processes, and the scaling path.
- [BACKEND.md](BACKEND.md) — every route and the reasoning behind the data model.
- [e2e/README.md](../e2e/README.md) — browser tests, and what not to assert.
