import { metrics, type Attributes, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

const UNMATCHED_ROUTE = 'unmatched';

const meter: Meter = metrics.getMeter('portfolio-dashboard', '0.1.0');

const httpRequestsTotal: Counter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests handled by the web process.',
});

const httpRequestDurationSeconds: Histogram = meter.createHistogram('http_request_duration_seconds', {
  description: 'HTTP request duration in seconds.',
  unit: 's',
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5] },
});

export const cacheHitsTotal: Counter = meter.createCounter('cache_hits_total', {
  description: 'Number of application response cache hits.',
});

export const cacheMissesTotal: Counter = meter.createCounter('cache_misses_total', {
  description: 'Number of application response cache misses.',
});

export const cacheCoalescedTotal: Counter = meter.createCounter('cache_coalesced_total', {
  description: 'Responses served by joining an in-flight load instead of a separate database read.',
});

function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : UNMATCHED_ROUTE;
}

export function observeHttpRequest(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.once('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    const labels: Attributes = {
      method: req.method,
      route: routeLabel(req),
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.add(1, labels);
    httpRequestDurationSeconds.record(durationSeconds, labels);
  });
  next();
}
