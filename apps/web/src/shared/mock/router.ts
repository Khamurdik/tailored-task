import * as auth from './handlers/auth';
import * as nodes from './handlers/nodes';
import * as shares from './handlers/shares';
import * as uploads from './handlers/uploads';
import { notFound, type MockRequest, type MockResponse } from './http';

type Handler = (request: MockRequest) => MockResponse;

interface Route {
  method: string;
  /** `/nodes/:id/children` — `:name` captures one segment. */
  pattern: string;
  handle: Handler;
}

const ROUTES: Route[] = [
  { method: 'POST', pattern: '/auth/login', handle: auth.login },
  { method: 'POST', pattern: '/auth/google', handle: auth.googleLogin },
  { method: 'POST', pattern: '/auth/refresh', handle: auth.refresh },
  { method: 'POST', pattern: '/auth/logout', handle: auth.logout },
  { method: 'GET', pattern: '/auth/me', handle: auth.me },

  // Before `/nodes/:id`, so the literal segment is not swallowed by the
  // parameter. Ordering is the routing bug that costs an afternoon.
  { method: 'GET', pattern: '/nodes', handle: nodes.listRooms },
  { method: 'POST', pattern: '/nodes', handle: nodes.createRoom },
  { method: 'POST', pattern: '/nodes/folders', handle: nodes.createFolder },
  { method: 'GET', pattern: '/nodes/:id/children', handle: nodes.listChildren },
  { method: 'GET', pattern: '/nodes/:id/stats', handle: nodes.getStats },
  { method: 'GET', pattern: '/nodes/:id/content-url', handle: uploads.contentUrl },
  { method: 'GET', pattern: '/nodes/:id/shares', handle: shares.listShares },
  { method: 'POST', pattern: '/nodes/:id/shares', handle: shares.createShare },
  { method: 'PATCH', pattern: '/nodes/:id/name', handle: nodes.renameNode },
  { method: 'PATCH', pattern: '/nodes/:id/parent', handle: nodes.moveNode },
  { method: 'GET', pattern: '/nodes/:id', handle: nodes.getNode },
  { method: 'DELETE', pattern: '/nodes/:id', handle: nodes.deleteNode },

  { method: 'POST', pattern: '/uploads/init', handle: uploads.initUpload },
  { method: 'POST', pattern: '/uploads/:id/complete', handle: uploads.completeUpload },
  { method: 'POST', pattern: '/uploads/:id/abort', handle: uploads.abortUpload },

  { method: 'GET', pattern: '/shares/resolve', handle: shares.resolveShare },
  { method: 'DELETE', pattern: '/shares/:id', handle: shares.revokeShare },
];

function match(pattern: string, path: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean);
  const actual = path.split('/').filter(Boolean);
  if (expected.length !== actual.length) return null;

  const params: Record<string, string> = {};
  for (const [index, segment] of expected.entries()) {
    const value = actual[index];
    if (value === undefined) return null;
    if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}

export function route(request: Omit<MockRequest, 'params'>): MockResponse {
  for (const candidate of ROUTES) {
    if (candidate.method !== request.method) continue;
    const params = match(candidate.pattern, request.path);
    if (params === null) continue;
    return candidate.handle({ ...request, params });
  }

  // An unrouted path is a 404 with the standard envelope, not a thrown error.
  // The client's error mapping should see the same shape it will see in
  // production, including for a URL the front end got wrong.
  return notFound();
}

/** Route table, for a dev-mode listing and for tests that assert coverage. */
export function mockRoutes(): readonly { method: string; pattern: string }[] {
  return ROUTES.map(({ method, pattern }) => ({ method, pattern }));
}
