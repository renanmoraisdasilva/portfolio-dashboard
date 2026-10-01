import { metrics, type Attributes, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

/**
 * Application metrics, on OpenTelemetry.
 *
 * These used to be `prom-client` instruments behind a `/metrics` endpoint that
 * scraped them in Prometheus text format. Two metrics systems were running at
 * once: this one, and the OTLP export in `telemetry.ts` that SigNoz actually
 * collects. Nothing consumed the Prometheus surface — no scrape config, no
 * Prometheus in the deployment, and `docs/SERVER-SETUP.md` names SigNoz as the
 * only observability stack — so the counters were written, served on a public
 * port, and never read.
 *
 * The signals are kept and re-expressed through the OTel API, so the same
 * numbers reach SigNoz and nothing is lost. `prom-client` is gone from the
 * dependency tree with it.
 *
 * Two details worth knowing:
 *
 * - **Instruments are created once, at module load.** The OTel API exposes no
 *   global `createCounter`; instruments come from a `Meter`, which
 *   `metrics.getMeter()` returns. `getMeter()` returns a *proxy* that binds to
 *   whichever `MeterProvider` is registered, so the handles below are valid even
 *   though `telemetry.ts` registers its provider in a later module — and creating
 *   an instrument per request would allocate a handle per call.
 * - **`routeLabel` cannot use `req.path` for unmatched requests.** The raw path
 *   is attacker-controlled, and labelling a metric with it lets any unauthenticated
 *   caller mint an unbounded number of time series — on the Prometheus endpoint
 *   that meant unbounded memory until the process died. A constant label cannot
 *   be inflated that way. This mattered twice over: an unbounded series count is
 *   worse when it is also reachable from the internet.
 */

/** Where an unmatched request is recorded, instead of its raw path. */
const UNMATCHED_ROUTE = 'unmatched';

/**
 * The application meter.
 *
 * Obtained at module load rather than inside each record call: `getMeter` is
 * cheap but not free, and a meter proxy is stable for the process's lifetime.
 * `scope`/`version` are the conventional identity fields, and they are what make
 * these series attributable in SigNoz rather than an anonymous group.
 */
const meter: Meter = metrics.getMeter('portfolio-dashboard', '0.1.0');

/** Metric names, kept as they were so existing dashboards and queries still match. */
const httpRequestsTotal: Counter = meter.createCounter('http_requests_total', {
  description: 'Total number of HTTP requests handled by the web process.',
});

const httpRequestDurationSeconds: Histogram = meter.createHistogram('http_request_duration_seconds', {
  description: 'HTTP request duration in seconds.',
  unit: 's',
  // OTel takes explicit bucket boundaries; these are the ones the prom-client
  // histogram was created with, kept so the histograms stay comparable.
  advice: { explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5] },
});

export const cacheHitsTotal: Counter = meter.createCounter('cache_hits_total', {
  description: 'Number of application response cache hits.',
});

export const cacheMissesTotal: Counter = meter.createCounter('cache_misses_total', {
  description: 'Number of application response cache misses.',
});

/**
 * Requests that joined a load already in flight rather than reading the cache.
 *
 * Counted separately from both hits and misses on purpose. These callers did
 * receive the answer without a second database read, which is worth watching as
 * its own number, but they did not read the cache — folding them into
 * `cache_hits_total` made the hit ratio report request collapsing as if it were
 * cache effectiveness.
 */
export const cacheCoalescedTotal: Counter = meter.createCounter('cache_coalesced_total', {
  description: 'Responses served by joining an in-flight load instead of a separate database read.',
});

/**
 * The route pattern, or a constant when nothing matched.
 *
 * A matched route collapses to its Express pattern (`/api/trades/:id`), so the
 * label set stays bounded by the number of routes. An unmatched request has no
 * pattern, and its `req.path` is whatever the caller sent — so that becomes a
 * single shared label instead.
 */
function routeLabel(req: Request): string {
  return req.route?.path ? `${req.baseUrl}${req.route.path}` : UNMATCHED_ROUTE;
}

/**
 * Records method, route and status for every finished request.
 *
 * The route is resolved in the `finish` handler rather than on the way in,
 * because `req.route` is only populated once Express has matched the request to
 * a route — which has not happened yet in a `use` middleware.
 */
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
