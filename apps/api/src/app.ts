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
import analyticsRouter from './routes/analytics';
import { portfolioRouter } from './routes/portfolio';
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
  // Strangler seam: the Vue app owns `/`. Static assets stay at the root because
  // the app references them by absolute path (/static/..., /icon.png). Nothing
  // else in the repository is served any more — the old `express.static(repoRoot)`
  // also exposed node_modules and .git.
  //
  // The Vue app owns every route the header links to; only these three kinds of
  // path are served from the repository itself.
  app.use('/static', express.static(path.join(repoRoot, 'static')));
  app.get('/icon.png', (_req, res) => res.sendFile(path.join(repoRoot, 'icon.png')));
  // Old bookmarks keep resolving: /pages/x.html and /x.html follow the page to
  // wherever it ended up. Anything not in the table lands on the dashboard.
  const migratedPages: Record<string, string> = { analytics: '/analytics', simulation: '/simulation' };
  const pageTarget = (file: string): string => migratedPages[file.replace(/\.html$/, '')] ?? '/';
  app.get('/pages/:file', (req, res) => res.redirect(pageTarget(req.params.file)));
  app.get('/index.html', (_req, res) => res.redirect('/'));
  app.get('/:page.html', (req, res) => res.redirect(pageTarget(req.params.page)));
  const webDist = path.join(repoRoot, 'apps', 'web', 'dist');
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDist, 'index.html'), (err) => (err ? next() : undefined));
  });
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
  app.use('/api/scenarios', scenariosRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/portfolio', portfolioRouter);
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
