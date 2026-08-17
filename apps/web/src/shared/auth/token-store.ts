import { TokenPairSchema, type TokenPair } from '@dataroom/shared';

/**
 * The **only** module in this application that touches `localStorage`.
 *
 * That is an invariant, not a style preference, and `WEB-SHARED-008` asserts it
 * by scanning the source. Keeping it true means the storage format can change —
 * or move to `sessionStorage`, or to memory — without a search across seven
 * feature folders, and it means there is exactly one place to look when asking
 * "where could a token leak from?".
 *
 * Both tokens live here, and the trade that implies is written down in
 * `apps/api/src/auth/TODO.md`: a successful XSS reads both, so what is stolen
 * is seven days of access rather than one. The strict CSP is the mitigation
 * that actually works. What this buys is the elimination of CSRF as a category
 * — there is no ambient credential for a browser to attach to a cross-site
 * request — and non-browser clients that need no cookie jar.
 */

const STORAGE_KEY = 'dataroom.tokens';

type Listener = (pair: TokenPair | null) => void;

const listeners = new Set<Listener>();

/**
 * `localStorage` throws rather than returning null in two real situations:
 * Safari's private mode, and a browser configured to block site data. Neither
 * should crash the app — both mean "there is no session", which is a state the
 * app already knows how to render.
 */
function safeRead(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function safeWrite(value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(STORAGE_KEY);
    else globalThis.localStorage?.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable. The session becomes tab-lifetime only, which is a
    // degraded experience rather than a broken one.
  }
}

/**
 * Returns the stored pair, or null.
 *
 * **A malformed value reads as logged-out, never as an error.** Anything could
 * be under this key — a half-written value from a killed tab, a leftover from
 * an older format, something a user pasted into devtools — and the only useful
 * response to all of them is the same one: there is no session. Throwing here
 * would break the app at boot, before any screen exists to explain why.
 */
export function get(): TokenPair | null {
  const raw = safeRead();
  if (raw === null) return null;

  try {
    const parsed = TokenPairSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function set(pair: TokenPair): void {
  safeWrite(JSON.stringify(pair));
  emit(pair);
}

export function clear(): void {
  safeWrite(null);
  emit(null);
}

/** Notifies on changes made **in this tab**. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Notifies when *another tab* signs out.
 *
 * Only removals. The `storage` event also fires for a rotation — every
 * successful refresh writes a new pair — and reacting to those is how a refresh
 * loop starts: two tabs each treating the other's write as news and re-reading,
 * or worse, re-refreshing. A rotation needs no reaction at all, because the
 * next request reads the store fresh anyway.
 *
 * A sign-out does need one. Otherwise the second tab keeps rendering the app
 * with a session that no longer exists, until something happens to make it
 * issue a request.
 */
export function subscribeSignOut(listener: () => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY && event.newValue === null) listener();
  };

  globalThis.addEventListener?.('storage', onStorage);
  return () => globalThis.removeEventListener?.('storage', onStorage);
}

function emit(pair: TokenPair | null): void {
  for (const listener of listeners) listener(pair);
}
