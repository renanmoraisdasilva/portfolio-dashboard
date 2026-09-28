# Portfolio Dashboard

A full-stack portfolio dashboard repository: a Vue 3 frontend (`apps/web`) being migrated from vanilla pages, and a TypeScript + Express backend.

## What is included

- `apps/web/` — the Vue app and the whole user-facing frontend: dashboard at `/`, `/analytics`, `/simulation`.
- `pages/sql-explorer.html` — the only vanilla page left: a read-only SQL console over `portfolio.db`, gated behind `ENABLE_SQL_EXPLORER`.
- `apps/api/` — backend implementation with Express, SQLite, routes, migrations, and tests.
- `packages/shared/` — API types generated from the OpenAPI spec, plus pure domain logic shared by both apps.
- `apps/api/openapi.yaml` — API specification for the backend endpoints.
- `docs/` — architecture, server setup, backend API notes, and the modernization plan.
- `fixtures/` — synthetic sample dataset used for seeding.

## Project structure

This is an npm workspaces monorepo:

```text
apps/
  api/           TypeScript + Express + SQLite backend (Drizzle ORM)
    src/           web.ts, worker.ts, app.ts, routes/, services/, jobs/
    Dockerfile     multi-stage image build
    openapi.yaml   OpenAPI 3 spec for the backend API
  web/           Frontend workspace — Vue 3 + Vite scaffold (empty; Phase 4 of the plan)
packages/
  shared/        Shared contracts + domain logic scaffold (empty; Phase 2 of the plan)
pages/           Static HTML pages served by the backend
static/          JS and CSS assets for the static pages
fixtures/        Synthetic seed and import datasets
docs/            Project documentation
scripts/         Benchmark and k6 load-test scripts
```

`apps/web` and `packages/shared` are workspace placeholders only — they contain a
`package.json` and nothing else until Phases 4 and 2 of
`docs/MODERNIZATION-PLAN.md` fill them in.

- `apps/api/package.json` — backend install and runtime scripts
- `apps/api/tsconfig.json` — TypeScript config
- `vitest.config.ts` - one test runner for the whole workspace (API, web, shared)
- `package.json` — workspace root: `dev`, `build`, `test`, `check`

## Getting started

### Backend

Run from the repository root:

```bash
npm install
npm run migrate:init   # optional: import fixtures/portfolio_data.json into an empty DB
npm run dev
```

- `npm run migrate:init` initializes SQLite tables and applies migrations.
- `npm run dev` starts the backend in development mode with hot reload.
- `npm run start:web` starts only the web process from compiled output.
- `npm run start:worker` starts only the scheduled-work process from compiled output.

### Dashboard load workflow

The k6 workflow models the dashboard's initial request sequence and reports
request failures plus end-to-end workflow latency. Start the local stack first,
then run k6 from the repository root:

```bash
k6 run scripts/k6/dashboard-workflow.js
```

Set `BASE_URL`, `VUS`, `RAMP_UP`, `STEADY`, and `RAMP_DOWN` to adjust the test.
The default thresholds are less than 1% failed requests and a workflow p95
below 500 ms.

To run it with a SigNoz instance available on the Docker host:

```bash
docker compose -f docker-compose.local.yml up -d --build
BASE_URL=http://localhost:3000 k6 run scripts/k6/dashboard-workflow.js
```

### Local Docker with sample data

The local Compose file keeps data in the `portfolio-data` volume and starts a
one-shot seed container automatically after the web service is healthy:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

The seed imports the sample portfolio from `fixtures/portfolio_data.json`
and skips automatically if the database already contains data. To start over,
remove the local volume first and start the stack again:

```bash
docker compose -f docker-compose.local.yml down -v
```

### Frontend

The frontend is static HTML, CSS and plain JavaScript with no build step: four
pages under `pages/`, their scripts and stylesheets under `static/`. Start the
backend and open `http://localhost:3000` — it serves both the pages and the
`/api/*` endpoints they call, so opening the HTML over `file://` will render
the layout but not the data.

## Backend API docs

- The backend API is documented in `apps/api/openapi.yaml`.
- Swagger UI is available at `http://localhost:3000/api/docs` when the backend is running.
- Backend-specific usage notes are in `docs/README-backend.md`.

## Testing

Run the whole unit suite from the repository root (Vitest, across the API, the
web app and the shared package):

```bash
npm test
```

To run coverage:

```bash
npm run test:coverage
```

Browser smoke tests, which drive the built app in Chromium against a throwaway
database seeded from the fixture (see [e2e/README.md](e2e/README.md)):

```bash
npm run build      # the suite runs dist/, not ts-node
npm run test:e2e
```

To verify everything CI verifies — lint, formatting, build and tests:

```bash
npm run check
```

## Notes

- The backend uses SQLite and stores data in `apps/api/data/`.
- For a containerized deployment, the backend Dockerfile is in `apps/api/Dockerfile`.

## Additional resources

- `docs/README-backend.md` — backend API documentation
- `apps/api/openapi.yaml` — OpenAPI endpoint definitions and schemas
- `docs/ARCHITECTURE-OVERVIEW.md` — architecture, caching layers and schema diagrams
- `docs/SERVER-SETUP.md` — Ubuntu, Docker and Dokploy deployment
- `docs/HOME_ASSISTANT_SETUP.md` — alert notifications via Home Assistant
- `docs/MODERNIZATION-PLAN.md` — phased plan for moving the static frontend to Vue 3 + Vite
- `AGENTS.md` — conventions and pitfalls for working on this codebase
- `fixtures/` — synthetic dataset used for seeding
