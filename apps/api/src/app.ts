import express, { Express } from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import yaml from 'js-yaml';
import { stateRouter } from './routes/state';
import { healthRouter } from './routes/health';
import { tradesRouter } from './routes/trades';
import { historyRouter } from './routes/history';
import { cashRouter } from './routes/cash';
import { interestRouter } from './routes/interest';
import { pricesRouter } from './routes/prices';
import { assetRouter } from './routes/asset';
import { alertsRouter } from './routes/alerts';
import { configRouter } from './routes/config';
import { scenariosRouter } from './routes/scenarios';
import { migrationsRouter } from './routes/migrations';
import analyticsRouter from './routes/analytics';
import { sqlExplorerRouter } from './routes/sqlExplorer';
import { metricsText, observeHttpRequest } from './metrics';
import { invalidateResponseCaches } from './services/responseCache';

// __dirname is apps/api/src (dev) or apps/api/dist (compiled), so repo root is three levels up.
// This must mirror the container layout, where WORKDIR is /app/apps/api and pages/static live at /app.
const repoRoot = path.resolve(__dirname, '..', '..', '..');

export function createApp(): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(observeHttpRequest);
  app.use((req, res, next) => {
    res.once('finish', () => {
      if (/^(POST|PUT|PATCH|DELETE)$/.test(req.method) && res.statusCode < 400) {
        invalidateResponseCaches();
      }
    });
    next();
  });
  app.get('/metrics', async (_req, res) => {
    res.type('text/plain').send(await metricsText());
  });
  return app;
}

export function mountWebRoutes(app: Express): void {
  app.use(express.static(repoRoot));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(repoRoot, 'pages', 'index.html'));
  });

  app.get('/index.html', (_req, res) => res.redirect('/'));
  app.get('/simulation.html', (_req, res) => res.redirect('/pages/simulation.html'));
  app.get('/analytics.html', (_req, res) => res.redirect('/pages/analytics.html'));
  app.get('/sql-explorer.html', (_req, res) => res.redirect('/pages/sql-explorer.html'));

  app.use('/api/state', stateRouter);
  app.use('/api/health', healthRouter);
  app.use('/api/trades', tradesRouter);
  app.use('/api/history', historyRouter);
  app.use('/api/cash', cashRouter);
  app.use('/api/interest', interestRouter);
  app.use('/api/prices', pricesRouter);
  app.use('/api/asset', assetRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/migrations', migrationsRouter);
  // The SQL Explorer is an arbitrary-SQL console over HTTP with no
  // authentication, so it stays closed unless explicitly enabled. Off by
  // default, including in the Docker image — Phase 3 of
  // docs/MODERNIZATION-PLAN.md.
  const sqlExplorerEnabled = process.env.ENABLE_SQL_EXPLORER === 'true';
  app.use('/api/sql', (_req, res, next) => {
    if (sqlExplorerEnabled) return next();
    res.status(403).json({ error: 'SQL Explorer is disabled. Set ENABLE_SQL_EXPLORER=true to enable it.' });
  }, sqlExplorerRouter);
  app.use('/api/scenarios', scenariosRouter);
  app.use('/api/analytics', analyticsRouter);

  const openapiFile = path.resolve(__dirname, '..', 'openapi.yaml');
  try {
    const openapiRaw = fs.readFileSync(openapiFile, 'utf8');
    const openapiDoc = yaml.load(openapiRaw);
    if (openapiDoc) {
      app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiDoc));
    }
  } catch (err) {
    console.warn('Failed to load OpenAPI spec for Swagger UI:', err instanceof Error ? err.message : err);
  }
}
