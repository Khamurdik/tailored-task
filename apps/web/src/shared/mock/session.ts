import { mockDb, type MockShare, type MockUser } from './db';
import type { MockRequest } from './http';

/**
 * Who is calling.
 *
 * Mirrors the real `SessionGuard` in the one way that matters to the front end:
 * **it never fails on a missing credential.** An anonymous visitor holding a
 * share token is a legitimate caller, so resolving to `null` is a normal
 * outcome and the decision about whether that is allowed belongs to the
 * handler, not here.
 */
export type Actor =
  | { kind: 'user'; user: MockUser }
  | { kind: 'share'; share: MockShare }
  | null;

/** Opaque. The fake checks that a token was presented, never that it was valid. */
const TOKEN_PREFIX = 'mock-access-';

export function accessTokenFor(user: MockUser): string {
  return `${TOKEN_PREFIX}${user.id}`;
}

export function refreshTokenFor(user: MockUser): string {
  return `mock-refresh-${user.id}`;
}

export function userIdFromToken(token: string, prefix = TOKEN_PREFIX): string | null {
  return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

export function resolveActor(request: MockRequest): Actor {
  const db = mockDb();

  const shareToken = request.headers['x-share-token'];
  if (shareToken !== undefined && shareToken !== '') {
    const share = findLiveShareByCredential(shareToken);
    return share === null ? null : { kind: 'share', share };
  }

  const authorization = request.headers['authorization'];
  if (authorization !== undefined && authorization.startsWith('Bearer ')) {
    const userId = userIdFromToken(authorization.slice('Bearer '.length));
    const user = userId === null ? undefined : db.users.get(userId);
    if (user !== undefined) return { kind: 'user', user };
  }

  return null;
}

/**
 * Resolves a token *or* a 16-character short code, and applies expiry and
 * revocation here rather than in the caller.
 *
 * Doing it in one place is what makes every failure indistinguishable: unknown,
 * revoked, expired and never-existed all leave with `null`, and the handler has
 * no way to tell them apart even if it wanted to.
 */
export function findLiveShareByCredential(credential: string): MockShare | null {
  const now = Date.now();

  for (const share of mockDb().shares.values()) {
    const matches =
      share.token === credential ||
      (credential.length === 16 && share.shortCode?.toUpperCase() === credential.toUpperCase());
    if (!matches) continue;
    if (share.revokedAt !== null) return null;
    if (share.expiresAt !== null && Date.parse(share.expiresAt) <= now) return null;
    return share;
  }
  return null;
}
