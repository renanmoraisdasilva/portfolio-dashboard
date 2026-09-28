import express, { Express } from 'express';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createApp, mountWebRoutes } from './app';

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
  regexp?: RegExp;
}

interface MountedRoute {
  method: string;
  path: string;
}

const SPEC_FILE = path.resolve(__dirname, '..', 'openapi.yaml');
const API_BASE = '/api';

/**
 * Express 4 builds a mounted-router layer regexp from path-to-regexp, e.g.
 * app.use('/api/state', router) -> ^\/api\/state\/?(?=\/|$)
 */
function decodeMountPrefix(regexp: RegExp | undefined): string {
  if (!regexp) return '';
  const source = regexp.source;
  const body = source.startsWith('^') ? source.slice(1) : source;
  const trimmed = body.replace(/\\\/\?\(\?=\\\/\|\$\)$/, '');
  const prefix = trimmed.replace(/\\\//g, '/');
  if (!/^\/[A-Za-z0-9_\-/]*$/.test(prefix)) {
    throw new Error(`Cannot recover mount path from Express layer regexp: ${source}`);
  }
  return prefix;
}

function joinPath(prefix: string, routePath: string): string {
  const base = prefix.replace(/\/$/, '');
  const suffix = routePath === '/' ? '' : routePath;
  const combined = `${base}${suffix}`;
  return combined === '' ? '/' : combined;
}

/** Express `:id` and OpenAPI `{id}` both become `{param}` so the comparison is about shape. */
function normalizePath(p: string): string {
  const trimmed = p.replace(/\/$/, '') || '/';
  return trimmed
    .split('/')
    .map((segment) =>
      segment.startsWith(':') || (segment.startsWith('{') && segment.endsWith('}'))
        ? '{param}'
        : segment
    )
    .join('/');
}

function collectRoutes(stack: Layer[], prefix: string, out: MountedRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const routePaths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = Object.keys(layer.route.methods || {}).filter((m) => m !== '_all');
      for (const routePath of routePaths) {
        for (const method of methods) {
          out.push({ method: method.toUpperCase(), path: normalizePath(joinPath(prefix, routePath)) });
        }
      }
    } else if (layer.handle?.stack) {
      collectRoutes(layer.handle.stack, prefix + decodeMountPrefix(layer.regexp), out);
    }
  }
}

function mountedApiRoutes(app: Express): MountedRoute[] {
  const router = (app as unknown as { _router?: { stack?: Layer[] } })._router;
  if (!router?.stack) {
    throw new Error('Express app has no router stack — Express 5 introspection needs updating');
  }
  const all: MountedRoute[] = [];
  collectRoutes(router.stack, '', all);
  return all.filter((route) => route.path === API_BASE || route.path.startsWith(`${API_BASE}/`));
}

interface OperationMap {
  paths: Map<string, Set<string>>;
}

function loadSpecOperations(): OperationMap {
  const raw = fs.readFileSync(SPEC_FILE, 'utf8');
  const doc = yaml.load(raw) as {
    servers?: { url: string }[];
    paths?: Record<string, Record<string, unknown>>;
  };

  const serverUrl = doc.servers?.[0]?.url ?? '';
  if (!serverUrl.endsWith(API_BASE)) {
    throw new Error(`Expected servers[0].url to end with ${API_BASE}, got "${serverUrl}"`);
  }

  const paths = new Map<string, Set<string>>();
  const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  for (const [specPath, operations] of Object.entries(doc.paths ?? {})) {
    const full = normalizePath(`${API_BASE}${specPath}`);
    const methods = new Set<string>();
    for (const method of METHODS) {
      if (method in operations) methods.add(method.toUpperCase());
    }
    paths.set(full, methods);
  }
  return { paths };
}

const describeRoute = (route: MountedRoute): string => `${route.method} ${route.path}`;

describe('OpenAPI contract', () => {
  let app: Express;
  let mounted: MountedRoute[];
  let spec: OperationMap;

  beforeAll(() => {
    app = createApp();
    mountWebRoutes(app);
    mounted = mountedApiRoutes(app);
    spec = loadSpecOperations();
  });

  test('introspection finds the mounted API routers', () => {
    // A silent regression here would make the two assertions below vacuous.
    expect(mounted.length).toBeGreaterThanOrEqual(40);
    expect(new Set(mounted.map((r) => r.path.split('/')[2])).size).toBeGreaterThanOrEqual(14);
  });

  test('every mounted route is documented in openapi.yaml', () => {
    const undocumented = mounted.filter((route) => {
      const methods = spec.paths.get(route.path);
      return !methods || !methods.has(route.method);
    });

    expect(undocumented.map(describeRoute).sort()).toEqual([]);
  });

  test('every documented operation is still mounted', () => {
    const mountedKeys = new Set(mounted.map((route) => `${route.method} ${route.path}`));
    const stale: string[] = [];

    for (const [specPath, methods] of spec.paths) {
      for (const method of methods) {
        if (!mountedKeys.has(`${method} ${specPath}`)) stale.push(`${method} ${specPath}`);
      }
    }

    expect(stale.sort()).toEqual([]);
  });
});
