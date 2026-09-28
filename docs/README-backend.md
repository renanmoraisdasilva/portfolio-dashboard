# Backend

The `apps/api` workspace: TypeScript + Express + SQLite (Drizzle ORM) serving
the portfolio API and the static pages.

Getting started (dev):

- Install dependencies: run `npm install` from the repository root (npm workspaces)
- Initialize DB with sample data: npm run migrate:init
- Run in development mode: npm run dev
- Build: npm run build
- Start: npm start

API notes:
- The Vue views read granular endpoints: `/api/trades` for the ledger, `/api/cash` for both balances *and* both interest totals, `/api/interest/months?currency=BRL|USD` for the month lists, and `/api/history` or `/api/history/ohlc` for snapshots. There is no aggregated state blob any more — Phase 5 removed `GET /api/state`, which only duplicated these and needed its own cache to hide the cost.
- `GET /api/analytics` returns analytics snapshots and uses a 30-second process-local LRU cache with single-flight regeneration for concurrent misses.
- `GET /api/health` returns uptime plus the last price/asset-cache timestamps, and answers `503` with `{ ok: false, error }` when the database read fails — so the container healthcheck (`r.ok ? 0 : 1`) actually fails on a broken database.
- `GET /api/trades` and `POST /api/trades` and `DELETE /api/trades/:id` for trades CRUD.
- `GET /api/history` (supports `?range=` of `day`, `week`, `month`, `6months`, `year` or `all`), `POST /api/history/point`, `DELETE /api/history/:id`, `DELETE /api/history` to manage history points.
- `GET /api/prices` returns cached prices; the worker refreshes them on an 8-minute interval (`apps/api/src/jobs/priceRefresh.ts`).
- `GET /api/asset/{symbol}/history` returns cached/sourced asset history.
- `GET /api/cash` and `PUT /api/cash` to manage cash positions, plus `GET/POST /api/cash/entries` and `DELETE /api/cash/entries/:id` for individual entries.
- `GET /api/interest/months`, `POST /api/interest/months`, and `DELETE /api/interest/months/:month` to manage interest entries.
- `GET /api/state/export` and `POST /api/state/import` to export/import whole state.
- `GET /api/alerts`, `POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, plus `GET /api/alerts/triggered` and `POST /api/alerts/dismiss/:alertId`.
- `GET/POST/PUT/DELETE /api/scenarios` — saved simulation scenarios.
- `GET /api/config/symbols` — the symbol registry that populates every select and chart.
- `POST /api/migrations/backfill-prices` and `POST /api/migrations/backfill-cash` — maintenance migrations (see `AGENTS.md`).
- `GET /api/sql/tables`, `GET /api/sql/schema`, `POST /api/sql/query` — the SQL Explorer, **with no authentication**. Gated behind `ENABLE_SQL_EXPLORER=true` since Phase 3: the routes answer `403` unless the flag is set, and it is off by default — including in the Docker image.

Static content is served by the same app, split by the Phase 4 strangler seam:
- `GET /` — the Vue app (`apps/web/dist`), with a SPA fallback for client-side routes.
- `GET /legacy/<page>.html` — the not-yet-migrated vanilla pages from `pages/`.
- `GET /static/...` and `GET /icon.png` — shared assets; the legacy pages reference them by absolute path.
- Old links still resolve: `/pages/x.html` and `/x.html` both redirect to `/legacy/x.html`, and `/index.html` redirects to `/`.

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
- Roadmap work (Vue migration, API gating, coverage) lives in `docs/MODERNIZATION-PLAN.md`.
