# Portfolio Dashboard

A full-stack portfolio dashboard repository containing a static frontend experience and a TypeScript + Express backend.

## What is included

- `pages/index.html` — landing page or home experience for the portfolio dashboard.
- `pages/simulation.html` — additional frontend views in the repo.
- `apps/api/openapi.yaml` — API specification for the backend endpoints.
- `docs/README-backend.md` — detailed backend API and server notes.
- `apps/api/` — backend implementation with Express, SQLite, routes, migrations, and tests.
- `fixtures/` — synthetic sample dataset used for seeding.

## Project structure

This is an npm workspaces monorepo:

```text
apps/
  api/           TypeScript + Express + SQLite backend (Drizzle ORM)
    src/           web.ts, worker.ts, app.ts, routes/, services/, jobs/
    Dockerfile     multi-stage image build
    openapi.yaml   OpenAPI 3 spec for the backend API
  web/           Frontend workspace — Vue 3 + Vite (migrating from the static pages/)
packages/
  shared/        Contracts and pure domain logic shared by api and web
pages/           Static HTML pages served by the backend
static/          JS and CSS assets for the static pages
fixtures/        Synthetic seed and import datasets
docs/            Project documentation
scripts/         Benchmark and k6 load-test scripts
```

- `apps/api/package.json` — backend install and runtime scripts
- `apps/api/tsconfig.json` — TypeScript config
- `apps/api/jest.config.cjs` — Jest test config
- `package.json` — workspace root: `dev`, `build`, `test`, `check`

## Getting started

### Backend

Run from the repository root:

```bash
npm install
npm run migrate:init   # optional: import fixtures/portfolio_data.json into an empty DB
npm run dev
```

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

- `npm run migrate:init` initializes SQLite tables and applies migrations.
- `npm run dev` starts the backend in development mode with hot reload.
- `npm run start:web` starts only the web process from compiled output.
- `npm run start:worker` starts only the scheduled-work process from compiled output.

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

The frontend is primarily static HTML and can be opened directly in the browser from the repository root.

Alternatively, run the backend to serve the same pages over `http://localhost:3000/pages/`.

## Backend API docs

- The backend API is documented in `apps/api/openapi.yaml`.
- Swagger UI is available at `http://localhost:3000/api/docs` when the backend is running.
- Backend-specific usage notes are in `docs/README-backend.md`.

## Testing

## Testing

Run the whole suite from the repository root:

```bash
npm test
```

To run coverage:

```bash
npm run test:coverage
```

To verify the build and the tests together (what CI runs):

```bash
npm run check
```

## Notes

- The backend uses SQLite and stores data in `apps/api/data/`.
- For a containerized deployment, the backend Dockerfile is in `apps/api/Dockerfile`.

## Additional resources

- `docs/README-backend.md` — backend API documentation
- `apps/api/openapi.yaml` — OpenAPI endpoint definitions and schemas
- `docs/MODERNIZATION-PLAN.md` — phased plan for moving the static frontend to Vue 3 + Vite
- `fixtures/` — synthetic dataset used for seeding
