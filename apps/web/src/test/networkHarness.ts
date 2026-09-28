import { vi } from 'vitest';

/**
 * The network boundary, for every test that touches a store.
 *
 * `openapi-fetch` builds a `Request` before it calls `fetch`, and jsdom's
 * `Request` refuses a relative URL — which the app's `baseUrl: '/api'` always
 * is. Stubbing `fetch` alone therefore fails inside the client, before any stub
 * of ours is reached.
 *
 * Registering the mock here (a `setupFiles` entry) rather than in each suite
 * means it is in place before any module is imported, and the tests only have to
 * import `stubNetwork` and describe what the server answers. Everything above
 * the transport — `request()`, the stores, the error handling — is real code.
 */

export interface StubRoute {
  /** Matched against the path, e.g. `/api/portfolio/valuation`. */
  match: (path: string) => boolean;
  status?: number;
  body: unknown;
}

export interface NetworkHarness {
  /** Every URL the store requested, in order. */
  calls: string[];
  routes: StubRoute[];
  /** Make every call fail the way an offline tab does. */
  offline: boolean;
}

export const network: NetworkHarness = {
  calls: [],
  routes: [],
  offline: false,
};

/** The smallest stand-in with `openapi-fetch`'s contract. */
function makeCall() {
  return async function call(
    path: string,
    init?: { params?: { query?: Record<string, unknown> } },
  ): Promise<{ data?: unknown; error?: unknown; response: Response }> {
    const url = String(path);
    network.calls.push(url);
    if (network.offline) throw new TypeError('Failed to fetch');

    // Serialized query, so a test can assert on the parameters a call chose —
    // `?cash=investments` is the store telling the server which split it wants.
    const query = init?.params?.query;
    if (query) {
      const search = new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      if (search) network.calls[network.calls.length - 1] = `${url}?${search}`;
    }

    const [pathname] = url.split('?');
    const route = network.routes.find((r) => r.match(pathname));
    if (!route) {
      const response = new Response(JSON.stringify({ error: `unstubbed ${pathname}` }), { status: 501 });
      return { error: await response.json(), response };
    }
    const status = route.status ?? 200;
    const response = new Response(JSON.stringify(route.body), { status });
    const payload = await response.json();
    return status >= 400 ? { error: payload, response } : { data: payload, response };
  };
}

vi.mock('openapi-fetch', () => ({
  default: (options: { baseUrl?: string } = {}) => {
    const prefix = options.baseUrl ?? '';
    const call = makeCall();
    const withPrefix = (path: string, init?: { params?: { query?: Record<string, unknown> } }) => call(`${prefix}${path}`, init);
    return {
      GET: withPrefix,
      POST: withPrefix,
      PUT: withPrefix,
      PATCH: withPrefix,
      DELETE: withPrefix,
    };
  },
}));

/** Point the harness at a fresh set of routes and clear the call log. */
export function stubNetwork(routes: StubRoute[]): void {
  network.routes = routes;
  network.calls = [];
  network.offline = false;
}

/** Every valuation URL requested, in order. */
export function valuationCalls(): string[] {
  return network.calls.filter((url) => url.includes('/portfolio/valuation'));
}
