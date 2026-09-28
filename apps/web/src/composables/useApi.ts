import createClient from 'openapi-fetch';
import type { paths } from '@portfolio-dashboard/shared';

/**
 * A failed API call, with enough context to say which one.
 *
 * This replaces the old `lib/api.js` wrapper, which returned `null` on failure
 * and could not distinguish "the server said no" from "the server never
 * answered" from "the payload was empty". Phase 2 deleted that file; this is the
 * replacement the plan asked for.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  /** Parsed error body when the server sent one. */
  readonly details: unknown;

  constructor(
    method: string,
    path: string,
    status: number,
    details: unknown,
    options: { cause?: unknown } = {},
  ) {
    const serverMessage =
      details && typeof details === 'object' && 'error' in details
        ? String((details as { error: unknown }).error)
        : typeof details === 'string' && details
          ? details
          : '';
    super(`${method} ${path} failed with ${status}${serverMessage ? `: ${serverMessage}` : ''}`);
    // `Error(message, { cause })` is ES2022 and this app compiles below it.
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.details = details;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

/**
 * Typed client for the API.
 *
 * `paths` is generated from `apps/api/openapi.yaml`, which the OpenAPI
 * contract test keeps in sync with the routes Express actually mounts — so a
 * path or payload that drifts fails `vue-tsc` instead of the browser.
 *
 * `baseUrl: '/api'` keeps every call same-origin: in production the API serves
 * this bundle, and in dev the Vite proxy forwards /api to :3000.
 *
 * The client itself never throws (that is openapi-fetch's contract); wrap calls
 * in `request()` below to get an `ApiError` instead of a silent `undefined`.
 */
const client = createClient<paths>({ baseUrl: '/api' });

export function useApi() {
  return client;
}

/** The shape openapi-fetch resolves to, for any call. */
export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Awaits an API call and returns its payload, or throws `ApiError`.
 *
 * Passing the promise rather than the call keeps `openapi-fetch`'s generic
 * inference intact, so `request(api.GET('/trades'), 'GET', '/trades')` is typed
 * all the way to `Trade[]`.
 */
export async function request<T>(
  call: Promise<ApiResult<T>>,
  method: HttpMethod,
  path: string,
): Promise<T> {
  const { data, error, response } = await call;
  if (error !== undefined || !response.ok) {
    throw new ApiError(method, path, response.status, error ?? data, { cause: error });
  }
  return data as T;
}
