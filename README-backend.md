# Backend (Initial)

This folder contains a minimal TypeScript + Express server to provide API access for the portfolio dashboard.

Getting started (dev):

- Install dependencies: cd server && npm install
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
- `GET /pages/finance.html` will serve `pages/finance.html`.

Finance service (new): the app now exposes a Finance API backed by its own SQLite DB `server/data/finance.db`.
- `POST /api/finance/import` — import a finance JSON payload. The request body should include the finance data; if `year` is omitted from the payload, you may override it with `?year=<YYYY>`.
- `GET /api/finance?year=<YYYY>` — export the finance canonical JSON for the requested year. Defaults to the current year if omitted.
- `POST /api/finance/init` — initialize or migrate the finance DB schema.
- `GET /api/docs` — Swagger UI for the backend OpenAPI documentation.

Incomes:
- `POST /api/finance/incomes` — add an income. Body: `{ month, source, value, description?, year? }`
- `PUT /api/finance/incomes/:id` — update an income. Body: `{ source, value, description? }`
- `DELETE /api/finance/incomes/:id` — remove an income.

Fixed expenses:
- `GET /api/finance/fixed?month=<0-11>&year=<YYYY?>` — list fixed expenses for a month.
- `POST /api/finance/fixed` — add fixed. Body: `{ month, name, category, value, paymentMethod?, normallyDueDay?, paidOnDate?, year? }`
- `PUT /api/finance/fixed/:id` — update fixed. Body may include any of the same fields.
- `DELETE /api/finance/fixed/:id` — delete fixed.

Eventual expenses:
- `GET /api/finance/eventual?month=<0-11>&year=<YYYY?>` — list eventual expenses for a month.
- `POST /api/finance/eventual` — add eventual. Body: `{ month, category, value, description?, paymentMethod?, year? }`
- `PUT /api/finance/eventual/:id` — update eventual.
- `DELETE /api/finance/eventual/:id` — delete eventual.

Credit card expenses:
- `GET /api/finance/credit?card=<nuRenan|nuJu|nomad>&month=<0-11>&year=<YYYY?>` — list credit card transactions for a card/month.
- `POST /api/finance/credit` — add credit expense. Body: `{ card, month, category, value, paymentMethod?, description?, year? }`
- `PUT /api/finance/credit/:id` — update credit expense. Body may include `{ category?, value?, paymentMethod?, description?, paidOnDate? }`.
- `DELETE /api/finance/credit/:id` — delete credit expense.

Years and reset:
- `GET /api/finance/years` — list available finance years.
- `POST /api/finance/years` — create an empty year. Body: `{ year }`
- `POST /api/finance/years/:year/reset` — delete all finance data for that year.

If you prefer a dedicated URL like `/importer/`, place the page and its assets under `public/importer/` and mount it with `app.use('/importer', express.static(...))` in `server/src/index.ts`.

Docker notes:
- `pages/finance.html` is copied into the runtime image so it will be available at `/pages/finance.html` in the container.
- To persist `finance.db` across container restarts, mount the `server/data` folder as a volume when running the container:

  docker run -v /path/on/host:/app/server/data -p 3000:3000 your-image

  Or configure a volume in your `docker-compose.yml` to map `./server/data` to the container path `/app/server/data`.
- `GET /api/cash` and `PUT /api/cash` to manage cash positions.
- `GET /api/interest/months`, `POST /api/interest/months`, and `DELETE /api/interest/months/:month` to manage interest entries.
- `GET /api/prices` returns cached prices; a price refresh runner is initialized on server startup (stubbed).
- `GET /api/asset/{symbol}/history` returns cached/sourced asset history.
- `GET /api/export` and `POST /api/import` to export/import whole state.

## Response caching

The response cache is implemented in `server/src/services/responseCache.ts` with
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
- The server persists data in `server/data/portfolio.db` (SQLite). Use `npm run migrate:init` to import `portfolio_data.json` into the DB.
- For a production setup, run the server in Docker (see `server/Dockerfile`) and use the GitHub Actions workflow to build images.

Next steps:
- Finish implementing robust price fetching, asset history caching, and backups.
- Add optional authentication and TLS if exposing beyond LAN.
- Adapt the frontend to use the API for all operations (already started).
