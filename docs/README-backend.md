# Backend (Initial)

This folder contains a minimal TypeScript + Express server to provide API access for the portfolio dashboard.

Getting started (dev):

- Install dependencies: run `npm install` from the repository root (npm workspaces)
- Initialize DB with sample data: npm run migrate:init
- Run in development mode: npm run dev
- Build: npm run build
- Start: npm start

API notes:
- `GET /api/state` returns the compact app state (trades, cash, interest months). Historical snapshots are loaded separately through `/api/history` or `/api/history/ohlc` so the dashboard does not download them twice. The assembled response uses a 10-second process-local LRU cache and is invalidated after successful mutations.
- `GET /api/analytics` returns analytics snapshots and uses a 30-second process-local LRU cache with single-flight regeneration for concurrent misses.
- `GET /api/health` returns basic health info.
- `GET /api/trades` and `POST /api/trades` and `DELETE /api/trades/:id` for trades CRUD.
- `GET /api/history` (supports `?range=` of `day`, `week`, `month`, `6months`, `year` or `all`), `POST /api/history/point`, `DELETE /api/history/:id`, `DELETE /api/history` to manage history points.

Static pages: HTML files are organized under `pages/` and served by the same app via static middleware. For example:
- `GET /pages/index.html` will serve `pages/index.html`.
- `GET /api/docs` — Swagger UI for the backend OpenAPI documentation.

If you prefer a dedicated URL like `/importer/`, place the page and its assets under `public/importer/` and mount it with `app.use('/importer', express.static(...))` in `apps/api/src/index.ts`.

Docker notes:
- To persist `portfolio.db` across container restarts, mount the `apps/api/data` folder as a volume when running the container:

  docker run -v /path/on/host:/app/apps/api/data -p 3000:3000 your-image

  Or configure a volume in your `docker-compose.yml` to map `./apps/api/data` to the container path `/app/apps/api/data`.
- `GET /api/cash` and `PUT /api/cash` to manage cash positions.
- `GET /api/interest/months`, `POST /api/interest/months`, and `DELETE /api/interest/months/:month` to manage interest entries.
- `GET /api/prices` returns cached prices; a price refresh runner is initialized on server startup (stubbed).
- `GET /api/asset/{symbol}/history` returns cached/sourced asset history.
- `GET /api/export` and `POST /api/import` to export/import whole state.

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
- The server persists data in `apps/api/data/portfolio.db` (SQLite). Use `npm run migrate:init` to import `portfolio_data.json` into the DB.
- For a production setup, run the server in Docker (see `apps/api/Dockerfile`) and use the GitHub Actions workflow to build images.

Next steps:
- Finish implementing robust price fetching, asset history caching, and backups.
- Add optional authentication and TLS if exposing beyond LAN.
- Adapt the frontend to use the API for all operations (already started).
