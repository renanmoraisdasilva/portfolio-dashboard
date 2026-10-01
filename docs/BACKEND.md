# Backend

The `apps/api` workspace: TypeScript + Express + SQLite (Drizzle ORM) serving
the portfolio API and the built Vue SPA. Renamed from `README-backend.md` in
so the only file called a README is the root one; the Quickstart table in
[the root README](../README.md) is the entry point, and this is the detail.

Getting started (dev):

- Install dependencies: run `npm install` from the repository root (npm workspaces)
- Initialize DB with sample data: `npm run seed:local` (the old `migrate:init` is
  the legacy import path; migrations themselves run automatically on first start)
- Run in development mode: `npm run dev`
- Build: `npm run build`
- Start: `npm start`

Two processes share one database file: the web process (`src/web.ts`) and the
worker (`src/worker.ts`), which runs the price, history and analytics jobs.
`src/index.ts` is a compatibility dispatcher for local `APP_ROLE` use.

API notes:

- The Vue views read granular endpoints: `/api/trades` for the ledger, `/api/cash` for both balances _and_ both interest totals, `/api/interest/months?currency=BRL|USD` for the month lists, and `/api/history` or `/api/history/ohlc` for snapshots. There is no aggregated state blob any more - `GET /api/state` was removed, which only duplicated these and needed its own cache to hide the cost.
- `GET /api/analytics` returns analytics snapshots and uses a 30-second process-local LRU cache with single-flight regeneration for concurrent misses.
- `GET /api/portfolio/valuation?cash=with-cash|investments` returns the portfolio's _derived_ values — total, invested cost, realized and unrealized P/L, one row per position and per cash balance, the allocation split, and the sale count — computed by `computeValuation` in `packages/shared`. Every amount is a plain number and each row states the currency it is in, because deciding that (a BRL quote, a bond stored in USD but shown in BRL, a BRL balance earning BRL interest) is domain knowledge. `?cash` picks whether the allocation percentages include the cash balances; the dashboard refetches when the toggle flips. The simulator does not use this endpoint — its prices are hypothetical — and calls the same function instead.
- `GET /api/health` returns uptime plus the last price/asset-cache timestamps, and answers `503` with `{ ok: false, error }` when the database read fails — so the container healthcheck (`r.ok ? 0 : 1`) actually fails on a broken database.
- `GET /api/trades` and `POST /api/trades` and `DELETE /api/trades/:id` for trades CRUD.
- `GET /api/history` (supports `?range=` of `day`, `week`, `month`, `6months`, `year` or `all`), `POST /api/history/point`, `DELETE /api/history/:id`, `DELETE /api/history` to manage history points.
- `GET /api/prices` returns cached prices; the worker refreshes them on an 8-minute interval (`apps/api/src/jobs/priceRefresh.ts`).
- `GET /api/asset/{symbol}/history` returns cached/sourced asset history.
- `GET /api/cash` and `PUT /api/cash` to manage cash positions, plus `GET/POST /api/cash/entries` and `DELETE /api/cash/entries/:id` for individual entries.
- `GET /api/interest/months`, `POST /api/interest/months`, and `DELETE /api/interest/months/:month` to manage interest entries. The `interest` table has no key of its own, so `POST` deletes `(month, currency)` before inserting — without that, editing an amount appended a second row and counted the month twice.
- `GET /api/state/export` and `POST /api/state/import` — the application's only backup mechanism. The export carries every table that cannot be re-derived: trades, portfolio snapshots, interest, cash, alerts, scenarios, `price_cache`, `asset_chart_cache` and `analytics_snapshots`. It excludes `price_ticks`, which is refetched from Yahoo and would exceed the 10 MB body limit the import accepts, and `__drizzle_migrations`, so a restore cannot claim a migration history it does not have. The import **replaces** every table the payload carries rather than merging, so a row absent from the backup is removed; a key that is absent leaves its table untouched. All of it runs in one transaction.
- `GET /api/alerts`, `POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, plus `GET /api/alerts/triggered` and `POST /api/alerts/dismiss/:alertId`.
- `GET/POST/PUT/DELETE /api/scenarios` — saved simulation scenarios.
- `GET /api/config/symbols` — the symbol registry that populates every select and chart.
- `GET /api/history` (with an optional `range`), `POST /api/history/point`, `DELETE /api/history/:id` and `GET /api/history/ohlc` (candles derived from the snapshots). `POST /api/history/fill-gaps` and `DELETE /api/history` have both been removed — the first was a one-time repair of the early record, the second had no confirmation or way back, and a restore from a backup now covers that case.

No route takes a statement string and executes it — see the note in
[AGENTS.md](../AGENTS.md). For ad-hoc inspection, `npm run db:studio` opens the
SQLite file in Drizzle Studio without opening a port.

Static content is served by the same app, split by the strangler seam:

- `GET /` — the Vue app (`apps/web/dist`), with a SPA fallback for client-side routes.
- `GET /static/...` and `GET /icon.png` — shared assets, referenced by absolute path.
- `GET /<page>.html` and `GET /pages/<page>.html` — 302 redirects so old bookmarks follow a page to its Vue route (`/analytics.html` → `/analytics`), and `/index.html` → `/`.

Nothing else in the repository is served — the previous `express.static(repoRoot)` also exposed `node_modules/` and `.git/`.

Other endpoints of note:

- `GET /api/docs` — Swagger UI for the backend OpenAPI documentation.

## Docker notes

- To persist `portfolio.db` across container restarts, mount the `apps/api/data` folder as a volume when running the container:

  ```bash
  docker run -v /path/on/host:/app/apps/api/data -p 3000:3000 your-image
  ```

  Or configure a volume in your `docker-compose.yml` to map `./apps/api/data` to the container path `/app/apps/api/data`.

## Response caching

The response cache is implemented in `apps/api/src/services/responseCache.ts` with
the open-source `lru-cache` package. It is lazy, bounded, TTL-based, and
process-local. A cache entry is created only after a request needs it; no work
runs merely because the TTL elapsed. Concurrent misses for the same key share
one promise. Successful write requests clear the cache so the next read sees
fresh data.

The cache is intentionally process-local for the current single-web-process
deployment. It must move to a shared backend such as Redis before running
multiple web replicas.

Cache metrics remain available at `/metrics` for local diagnostics, while the
production metrics signal is exported to SigNoz over OTLP:

```text
cache_hits_total{cache="state"}
cache_hits_total{cache="analytics"}
cache_misses_total{cache="state"}
cache_misses_total{cache="analytics"}
```

Notes:

- The server persists data in `apps/api/data/portfolio.db` (SQLite). Use `npm run migrate:init` to import `fixtures/portfolio_data.json` into the DB.
- For a production setup, run the server in Docker (see `apps/api/Dockerfile`) and use the GitHub Actions workflow to build images — see `docs/SERVER-SETUP.md`.
