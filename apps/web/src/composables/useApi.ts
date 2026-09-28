import createClient from 'openapi-fetch';
import type { paths } from '@portfolio-dashboard/shared';

/**
 * Typed client for the API.
 *
 * `paths` is generated from `apps/api/openapi.yaml`, which the OpenAPI
 * contract test keeps in sync with the routes Express actually mounts — so a
 * path or payload that drifts fails `vue-tsc` instead of the browser.
 *
 * `baseUrl: ''` keeps every call same-origin: in production the API serves
 * this bundle, and in dev the Vite proxy forwards /api to :3000.
 */
const client = createClient<paths>({ baseUrl: '' });

export function useApi() {
  return client;
}
