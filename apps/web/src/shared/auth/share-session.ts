/**
 * The share credential for the current route, held **in memory only**.
 *
 * Not in the token store, and not in `localStorage`. A share token belongs to
 * one tab looking at one link; persisting it would mean a visitor who opened a
 * share link yesterday still carries it into every request today, including
 * after they sign in as themselves — which is exactly how a share view and an
 * owner view start sharing state.
 *
 * The `/s/:code` route sets it on mount and clears it on unmount. Everything
 * else reads it.
 */
let shareToken: string | null = null;

export function setShareToken(token: string | null): void {
  shareToken = token === null || token.trim() === '' ? null : token.trim();
}

export function getShareToken(): string | null {
  return shareToken;
}

/**
 * Which credential a request should carry — **never both**.
 *
 * An owner request carrying a share token, or a share request carrying the
 * owner's bearer, is the mechanism by which the two views bleed into each
 * other: the server would resolve whichever it recognises, and the public page
 * would quietly start rendering owner-scoped data. Returning a single tagged
 * value makes "both" unrepresentable rather than merely discouraged.
 */
export type Credential =
  | { kind: 'bearer'; token: string }
  | { kind: 'share'; token: string }
  | { kind: 'none' };
