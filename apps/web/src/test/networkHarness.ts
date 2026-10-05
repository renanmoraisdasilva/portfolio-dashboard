import { vi } from 'vitest';

export interface StubRoute {
  match: (path: string) => boolean;
  status?: number;
  body: unknown;
}

export interface NetworkHarness {
  calls: string[];
  routes: StubRoute[];
  offline: boolean;
}

export const network: NetworkHarness = {
  calls: [],
  routes: [],
  offline: false,
};

function makeCall() {
  return async function call(
    path: string,
    init?: { params?: { query?: Record<string, unknown> } },
  ): Promise<{ data?: unknown; error?: unknown; response: Response }> {
    const url = String(path);
    network.calls.push(url);
    if (network.offline) throw new TypeError('Failed to fetch');

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

export function stubNetwork(routes: StubRoute[]): void {
  network.routes = routes;
  network.calls = [];
  network.offline = false;
}

export function valuationCalls(): string[] {
  return network.calls.filter((url) => url.includes('/portfolio/valuation'));
}
