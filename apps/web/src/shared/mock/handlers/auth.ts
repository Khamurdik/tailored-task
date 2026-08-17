import {
  GoogleLoginRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  type LoginResponse,
  type SessionUser,
} from '@dataroom/shared';

import { mockDb, type MockUser } from '../db';
import { fail, noContent, ok, unauthenticated, type MockRequest, type MockResponse } from '../http';
import { accessTokenFor, refreshTokenFor, resolveActor, userIdFromToken } from '../session';

const sessionUser = (user: MockUser): SessionUser => ({
  id: user.id,
  email: user.email,
  name: user.name,
  isAdmin: user.isAdmin,
});

const tokenPair = (user: MockUser): LoginResponse => ({
  accessToken: accessTokenFor(user),
  refreshToken: refreshTokenFor(user),
  user: sessionUser(user),
});

/**
 * One response for every login failure.
 *
 * Wrong password, unknown email and a password-less account are
 * byte-identical, because splitting them hands the client an email oracle the
 * API is deliberately built to withhold. The mock keeps the rule so the login
 * screen is built against one failure state rather than three.
 */
const loginFailed = (): MockResponse =>
  fail(401, 'UNAUTHENTICATED', 'Those credentials did not match an account');

export function login(request: MockRequest): MockResponse {
  const parsed = LoginRequestSchema.safeParse(request.body);
  if (!parsed.success) return loginFailed();

  const email = parsed.data.email.normalize('NFC').trim().toLowerCase();
  const user = [...mockDb().users.values()].find(
    (candidate) => candidate.email.toLowerCase() === email,
  );

  if (user === undefined || user.password !== parsed.data.password) return loginFailed();
  return ok(tokenPair(user));
}

/**
 * Google sign-in **links to an existing account and never creates one.**
 *
 * The mock accepts any token whose value is an email it already knows, which is
 * enough to build the button and the two outcomes against. The rule worth
 * preserving is the second one: an unknown email is the same generic failure as
 * a bad password, not "no account for this address".
 */
export function googleLogin(request: MockRequest): MockResponse {
  const parsed = GoogleLoginRequestSchema.safeParse(request.body);
  if (!parsed.success) return loginFailed();

  const claimed = parsed.data.idToken.trim().toLowerCase();
  const user = [...mockDb().users.values()].find(
    (candidate) => candidate.email.toLowerCase() === claimed,
  );

  return user === undefined ? loginFailed() : ok(tokenPair(user));
}

export function refresh(request: MockRequest): MockResponse {
  const parsed = RefreshRequestSchema.safeParse(request.body);
  if (!parsed.success) return unauthenticated();

  const userId = userIdFromToken(parsed.data.refreshToken, 'mock-refresh-');
  const user = userId === null ? undefined : mockDb().users.get(userId);
  if (user === undefined) return unauthenticated();

  // Rotation is real enough to matter: the client's single-flight lock exists
  // because two concurrent refreshes would replay a rotated token, and that is
  // only exercisable if a new pair actually comes back.
  return ok(tokenPair(user));
}

export function logout(): MockResponse {
  return noContent();
}

export function me(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  if (actor?.kind !== 'user') return unauthenticated();
  return ok(sessionUser(actor.user));
}
