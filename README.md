# Portfolio Dashboard

A full-stack portfolio dashboard repository containing a static frontend experience and a TypeScript + Express backend for finance data.

## What is included

- `pages/finance.html` — main finance dashboard UI with fixed/eventual expenses, credit card handling, charts, and local finance state.
- `pages/index.html` — landing page or home experience for the portfolio dashboard.
- `pages/simulation.html`, `pages/vocabulary-learning.html` — additional frontend views in the repo.
- `openapi.yaml` — API specification for backend finance and portfolio endpoints.
- `README-backend.md` — detailed backend API and server notes.
- `server/` — backend implementation with Express, SQLite, finance routes, migrations, and tests.
- `backup-data/` — sample dataset files for the project.

## Project structure

- `server/` — TypeScript backend
  - `src/` — server source code
    - `web.ts` — web process entrypoint
    - `worker.ts` — scheduled-work process entrypoint
    - `app.ts` — Express app creation and route mounting
    - `jobs/` — scheduled price, analytics, and history work
    - `index.ts` — compatibility dispatcher for `APP_ROLE=web|worker|all`
    - `routes/` — API route definitions
    - `services/` — finance and domain logic
    - `financeDb.ts` — SQLite data access helpers
    - `migrate.ts` — DB migration and initialization script
  - `package.json` — backend install and runtime scripts
  - `tsconfig.json` — TypeScript config
  - `jest.config.cjs` — Jest test config

- `openapi.yaml` — OpenAPI 3 docs for the backend API
- `README-backend.md` — backend readme with finance API details
- `README.md` — root project documentation

## Getting started

### Backend

```bash
cd server
npm install
npm run migrate:init
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

- `npm run migrate:init` initializes SQLite tables and applies finance DB migrations.
- `npm run dev` starts the backend in development mode with hot reload.
- `npm run start:web` starts only the web process from compiled output.
- `npm run start:worker` starts only the scheduled-work process from compiled output.

### Local Docker with sample data

The local Compose file keeps data in the `portfolio-data` volume and starts a
one-shot seed container automatically after the web service is healthy:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

The seed imports the sample portfolio from `backup-data/portfolio_data.json`
and skips automatically if the database already contains data. To start over,
remove the local volume first and start the stack again:

```bash
docker compose -f docker-compose.local.yml down -v
```

### Frontend

The frontend is primarily static HTML and can be opened directly in the browser from the repository root.

Alternatively, run the backend and serve the repo root if you want to access `pages/finance.html` via the web server.

## Backend API docs

- The backend finance API is documented in `openapi.yaml`.
- Swagger UI is available at `http://localhost:3000/api/docs` when the backend is running.
- Backend-specific usage notes are in `README-backend.md`.

Key finance routes:

- `GET /api/finance?year=<YYYY>` — export finance state
- `POST /api/finance/import` — import finance JSON
- `POST /api/finance/init` — initialize/migrate the finance DB
- `POST /api/finance/incomes` — add income
- `GET /api/finance/fixed` — list fixed expenses
- `POST /api/finance/fixed` — add fixed expense
- `PUT /api/finance/fixed/:id` — update fixed expense
- `POST /api/finance/years/:year/reset` — reset a year

## Testing

Run backend tests from the `server/` folder:

```bash
cd server
npm test
```

To run coverage:

```bash
cd server
npm run test:coverage
```

## Notes

- The finance backend uses SQLite and stores data in `server/data/`.
- The finance frontend can work with `localStorage` or fetch from the backend API when available.
- For a containerized deployment, the backend Dockerfile is in `server/Dockerfile`.

## Additional resources

- `README-backend.md` — backend API and finance service documentation
- `openapi.yaml` — OpenAPI endpoint definitions and schemas
