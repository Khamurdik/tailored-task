import { TokenPairSchema, type TokenPair } from '@dataroom/shared';
import type { AxiosInstance } from 'axios';

import * as tokenStore from '../auth/token-store';

export const REFRESH_PATH = '/auth/refresh';

/**
 * Refreshing the session, exactly once per browser profile at a time.
 *
 * ## Why a lock and not a promise
 *
 * The obvious implementation caches the in-flight promise so concurrent 401s
 * await one refresh. That is necessary and not sufficient: **every tab shares
 * one `localStorage` and therefore one refresh token**, so two tabs hitting 401
 * at the same moment each start their own "single" flight, and the second one
 * presents a token the server has already rotated. The server treats a replayed
 * refresh token as theft and kills the whole family — so the symptom is both
 * tabs being logged out, under a burst of parallel requests, and never on the
 * slow single-request page anyone tests by hand.
 *
 * `navigator.locks` is the only primitive that spans tabs of one profile. A
 * `localStorage` mutex is not an alternative: it has no atomic
 * compare-and-set, so the check and the claim are two operations with a race
 * between them.
 *
 * ## The part that is easy to get wrong
 *
 * **The lock serialises; it does not deduplicate.** A waiter that acquires it
 * second and then refreshes anyway is the exact replay this exists to prevent.
 * So the token is captured *before* queueing, and re-read *inside* the lock: if
 * it changed while waiting, someone else already refreshed and the right move
 * is to use their result and make no request at all.
 */

const LOCK_NAME = 'auth-refresh';

/** Per-tab fallback, used only where `navigator.locks` does not exist. */
let inFlight: Promise<TokenPair | null> | null = null;

interface LockManagerLike {
  request: <T>(name: string, callback: () => Promise<T>) => Promise<T>;
}

function lockManager(): LockManagerLike | null {
  // Unavailable on insecure non-localhost origins, and in jsdom. Feature-detect
  // rather than assume — and note the fallback is a per-tab promise, accepting
  // the cross-tab race, because the alternative is a mutex that cannot be
  // correct.
  const locks = (globalThis.navigator as Navigator & { locks?: LockManagerLike } | undefined)?.locks;
  return locks ?? null;
}

export async function refreshSession(client: AxiosInstance): Promise<TokenPair | null> {
  // Captured before queueing. This is what tells a waiter, once it gets the
  // lock, whether the world moved while it was waiting.
  const presented = tokenStore.get()?.refreshToken ?? null;
  if (presented === null) return null;

  const locks = lockManager();
  if (locks === null) {
    inFlight ??= runOnce(client, presented).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return locks.request(LOCK_NAME, () => runOnce(client, presented));
}

async function runOnce(client: AxiosInstance, presented: string): Promise<TokenPair | null> {
  const current = tokenStore.get();

  // Someone refreshed while we queued. Use their pair — presenting `presented`
  // now would be a replay of an already-rotated token.
  if (current === null) return null;
  if (current.refreshToken !== presented) return current;

  try {
    const response = await client.post(
      REFRESH_PATH,
      // In the body. Never a query parameter, never a path segment — a refresh
      // token in a URL lands in browser history, in a `Referer` header, and in
      // every access log between here and the server.
      { refreshToken: current.refreshToken },
      { skipAuthRefresh: true },
    );

    const parsed = TokenPairSchema.safeParse(response.data);
    if (!parsed.success) return null;

    tokenStore.set(parsed.data);
    return parsed.data;
  } catch {
    /**
     * A failed refresh is a dead session, not a retryable error.
     *
     * Clearing **here, inside the lock**, is what makes a burst deterministic:
     * every waiter queued behind this one wakes up, reads an empty store, and
     * returns immediately. Clearing in the caller instead leaves a window in
     * which each waiter still sees the dead token, decides it is the one that
     * should refresh, and fires another doomed request — five requests, five
     * refresh calls, five redirects.
     */
    tokenStore.clear();
    return null;
  }
}

/** Test seam. Resets the per-tab fallback between cases. */
export function resetRefreshState(): void {
  inFlight = null;
}
