import type { ApiError, ErrorCode } from '@dataroom/shared';

/** What a handler returns. Shaped like an HTTP response, because that is what it is. */
export interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockRequest {
  method: string;
  /** Path only, no origin and no query string. */
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: Record<string, string>;
  /** Path parameters captured by the route pattern. */
  params: Record<string, string>;
}

export const ok = (body: unknown): MockResponse => ({ status: 200, body });
export const created = (body: unknown): MockResponse => ({ status: 201, body });
export const accepted = (body: unknown): MockResponse => ({ status: 202, body });
export const noContent = (): MockResponse => ({ status: 204, body: null });

export function fail(status: number, code: ErrorCode, message: string, details?: Record<string, unknown>): MockResponse {
  const body: ApiError = details === undefined ? { code, message } : { code, message, details };
  return { status, body };
}

/**
 * The only way this mock refuses anything a caller might not be allowed to see.
 *
 * Denial is 404, never 403 — a 403 confirms the id exists, which is an
 * enumeration oracle. Every denial returns this exact body, so a client cannot
 * tell "you may not" from "there is no such thing", and neither can a test that
 * is checking the client got that right.
 */
export const notFound = (): MockResponse => fail(404, 'NOT_FOUND', 'Not found');

export const unauthenticated = (): MockResponse =>
  fail(401, 'UNAUTHENTICATED', 'Authentication required');

export const validationFailed = (message: string): MockResponse =>
  fail(400, 'VALIDATION_FAILED', message);

export const nameConflict = (suggestedName: string): MockResponse =>
  fail(409, 'NAME_CONFLICT', 'A sibling with that name already exists', { suggestedName });
