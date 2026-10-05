import createClient from 'openapi-fetch';
import type { paths } from '@portfolio-dashboard/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly details: unknown;
  declare readonly cause?: unknown;

  constructor(method: string, path: string, status: number, details: unknown, options: { cause?: unknown } = {}) {
    const serverMessage =
      details && typeof details === 'object' && 'error' in details
        ? String((details as { error: unknown }).error)
        : typeof details === 'string' && details
          ? details
          : '';
    super(`${method} ${path} failed with ${status}${serverMessage ? `: ${serverMessage}` : ''}`);
    if (options.cause !== undefined) this.cause = options.cause;
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

const client = createClient<paths>({ baseUrl: '/api' });

export function useApi() {
  return client;
}

export interface ApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function request<T>(call: Promise<ApiResult<T>>, method: HttpMethod, path: string): Promise<T> {
  let result: ApiResult<T>;
  try {
    result = await call;
  } catch (cause) {
    throw new ApiError(method, path, 0, cause instanceof Error ? cause.message : String(cause), { cause });
  }
  const { data, error, response } = result;
  if (error !== undefined || !response.ok) {
    throw new ApiError(method, path, response.status, error ?? data, { cause: error });
  }
  return data as T;
}
