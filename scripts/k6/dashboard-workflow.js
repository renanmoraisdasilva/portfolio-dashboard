import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const workflowDuration = new Trend('dashboard_workflow_duration', true);
const workflowErrors = new Rate('dashboard_workflow_errors');

export const options = {
  stages: [
    { duration: __ENV.RAMP_UP || '15s', target: Number(__ENV.VUS || 5) },
    { duration: __ENV.STEADY || '45s', target: Number(__ENV.VUS || 5) },
    { duration: __ENV.RAMP_DOWN || '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    dashboard_workflow_errors: ['rate<0.01'],
    dashboard_workflow_duration: ['p(95)<500'],
  },
};

function get(path) {
  const response = http.get(`${baseUrl}${path}`, {
    tags: { workflow: 'dashboard' },
  });
  const ok = check(response, {
    [`${path} returns 200`]: (result) => result.status === 200,
  });
  workflowErrors.add(!ok);
  return response;
}

export default function () {
  const startedAt = Date.now();

  get('/api/trades');
  sleep(0.1);
  get('/api/cash');
  sleep(0.1);
  get('/api/prices');
  sleep(0.1);
  get('/api/history/ohlc?range=all&metric=value');
  sleep(0.1);
  get('/api/history/ohlc?range=all&metric=pnl');
  sleep(0.1);
  get('/api/analytics');
  sleep(0.1);
  get('/api/config/symbols');

  workflowDuration.add(Date.now() - startedAt);
}
