// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { ApiError, request, useApi } from './useApi';

describe('request()', () => {
  const ok = <T>(data: T) => Promise.resolve({ data, response: new Response(null, { status: 200 }) });

  test('returns the payload when the call succeeds', async () => {
    expect(await request(ok([{ id: 'a' }]), 'GET', '/trades')).toEqual([{ id: 'a' }]);
  });

  test('treats a 2xx response with no body as success, not as an error', async () => {
    const result = await request(
      Promise.resolve({ data: undefined, response: new Response(null, { status: 204 }) }),
      'DELETE',
      '/trades/{id}',
    );
    expect(result).toBeUndefined();
  });

  test('turns a non-2xx response into an ApiError', async () => {
    await expect(
      request(Promise.resolve({ error: { error: 'nope' }, response: new Response(null, { status: 422 }) }), 'POST', '/trades'),
    ).rejects.toThrow(ApiError);
  });

  test('turns a rejected call into an ApiError too, so callers have one type to catch', async () => {
    await expect(request(Promise.reject(new Error('socket hang up')), 'GET', '/prices')).rejects.toThrow(/GET \/prices failed/);
  });
});

describe('ApiError', () => {
  test('carries the status, method, path and parsed body', () => {
    const error = new ApiError('DELETE', '/trades/{id}', 409, { error: 'currency mismatch' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(409);
    expect(error.method).toBe('DELETE');
    expect(error.path).toBe('/trades/{id}');
    expect(error.details).toEqual({ error: 'currency mismatch' });
  });

  test('has a message readable on its own — it is what ends up in a toast', () => {
    expect(new ApiError('POST', '/trades', 409, { error: 'currency mismatch' }).message).toBe(
      'POST /trades failed with 409: currency mismatch',
    );
    expect(new ApiError('GET', '/x', 500, null).message).toBe('GET /x failed with 500');
  });

  test('accepts a body that is a bare string', () => {
    expect(new ApiError('GET', '/x', 500, 'boom').message).toBe('GET /x failed with 500: boom');
  });

  test('classifies the statuses a caller branches on', () => {
    expect(new ApiError('GET', '/x', 404, null).isNotFound).toBe(true);
    expect(new ApiError('GET', '/x', 500, null).isNotFound).toBe(false);
    expect(new ApiError('POST', '/x', 409, null).isConflict).toBe(true);
    expect(new ApiError('GET', '/x', 404, null).isConflict).toBe(false);
    expect(new ApiError('POST', '/x', 400, null).isValidation).toBe(true);
    expect(new ApiError('POST', '/x', 422, null).isValidation).toBe(true);
    expect(new ApiError('GET', '/x', 500, null).isValidation).toBe(false);
  });

  test('keeps the underlying failure as `cause`, so the stack survives', () => {
    const cause = new Error('socket hang up');
    expect(new ApiError('GET', '/prices', 0, undefined, { cause }).cause).toBe(cause);
  });
});

describe('useApi()', () => {
  test('returns a stable client, so every page shares one baseUrl', () => {
    expect(useApi()).toBe(useApi());
  });

  test('exposes the typed paths from the generated contract', () => {
    const client = useApi() as unknown as { GET: (path: string) => Promise<unknown> };
    expect(typeof client.GET).toBe('function');
  });
});
