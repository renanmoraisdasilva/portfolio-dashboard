import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests handled by the web process.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [metricsRegistry],
});

const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [metricsRegistry],
});

export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Number of application response cache hits.',
  labelNames: ['cache'] as const,
  registers: [metricsRegistry],
});

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Number of application response cache misses.',
  labelNames: ['cache'] as const,
  registers: [metricsRegistry],
});

function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
}

export function observeHttpRequest(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const labels = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });
  next();
}

export async function metricsText(): Promise<string> {
  return metricsRegistry.metrics();
}
