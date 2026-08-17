import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { getShareToken } from '../auth/share-session';
import * as tokenStore from '../auth/token-store';
import { toAppError } from '../errors/app-error';
import { installMockTransport } from '../mock';
import { REFRESH_PATH, refreshSession } from './refresh';

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Set on the refresh call itself, so a 401 from it cannot recurse. */
    skipAuthRefresh?: boolean;
    /** Set once a request has been retried, so it is never retried twice. */
    authRetried?: boolean;
  }
}

/**
 * What to do when the session is unrecoverable. Replaced by the app at
 * startup with a router navigation; the default keeps this module free of a
 * router dependency and still does the right thing.
 */
let onSessionExpired: () => void = () => {
  globalThis.location?.assign('/login');
};

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

/**
 * Guards the "redirect to login" path so it happens **once per dead session**.
 *
 * Without it, a burst of requests that all fail to refresh each navigates, and
 * the navigations interrupt each other — the loop `WEB-SHARED-005` catches.
 *
 * The flag resets when a session is next stored, rather than on a timer. A
 * timer was the first attempt and it is both racy and untestable: the window
 * has to outlive the burst but not the next genuine expiry, and no value is
 * right for both. Keying it to "a new session exists" needs no window at all.
 */
let notifiedExpired = false;
tokenStore.subscribe((pair) => {
  if (pair !== null) notifiedExpired = false;
});

export function createApiClient(): AxiosInstance {
  const instance = axios.create({
    // Relative, so dev goes through Vite's proxy and production through the
    // Vercel rewrite. One base URL across environments.
    /**
     * A **blank** value counts as unset, not as an empty base URL.
     *
     * `??` only catches null and undefined, so `VITE_API_URL=` in an env file
     * yields `''` — and every request then goes to the page's own origin, where
     * the dev server answers a POST with a 404 and the UI reports "that item is
     * not available" on the login screen. `.env` files spell "unset" as a blank
     * line all the time; the API's own config has the same rule
     * (`blankAsUndefined`), and the two should agree.
     */
    baseURL: blankToUndefined(import.meta.env.VITE_API_URL) ?? '/api',

    // No cookies, ever. There is no ambient credential in this system, which
    // is what removes CSRF as a category — and it is why CORS is
    // uncredentialed on the server side too. Flipping this is a change of
    // security model, not a configuration tweak.
    withCredentials: false,

    headers: { 'Content-Type': 'application/json' },
    timeout: 30_000,
  });

  instance.interceptors.request.use(attachCredential);
  instance.interceptors.response.use((response) => response, handleAuthFailure(instance));

  // A no-op unless `VITE_API_MODE=mock`. Installed last and below the
  // interceptors above, so everything they do still happens.
  installMockTransport(instance);

  return instance;
}

/**
 * Exactly one credential, never two.
 *
 * A share route sends `X-Share-Token` and **no** bearer; everything else sends
 * the bearer and **no** share token. Sending both would let the server resolve
 * whichever it recognises first, which is how an owner's data ends up rendered
 * on a public page.
 */
function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

function attachCredential(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  config.headers.delete('Authorization');
  config.headers.delete('X-Share-Token');

  const shareToken = getShareToken();
  if (shareToken !== null) {
    config.headers.set('X-Share-Token', shareToken);
    return config;
  }

  const accessToken = tokenStore.get()?.accessToken;
  if (accessToken !== undefined) {
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
}

function handleAuthFailure(instance: AxiosInstance) {
  return async function onRejected(error: unknown): Promise<never> {
    if (!(error instanceof AxiosError) || error.response?.status !== 401) {
      // Only a 401 goes down the refresh path. A 500 retried by it would
      // double every server error, and a 404 retried would hammer a resource
      // that is gone.
      throw toAppError(error);
    }

    const config = error.config;
    const isRefreshCall = config?.skipAuthRefresh === true || config?.url?.endsWith(REFRESH_PATH);

    // Already retried, or this *is* the refresh call. Either way there is
    // nothing left to try, and trying anyway is a recursion.
    if (config === undefined || config.authRetried === true || isRefreshCall === true) {
      throw toAppError(error);
    }

    // An anonymous share visitor has no session to refresh. Attempting one
    // would clear a store that was already empty and redirect them to a login
    // page they have no business seeing.
    if (getShareToken() !== null) throw toAppError(error);

    config.authRetried = true;
    const pair = await refreshSession(instance);

    if (pair === null) {
      expireSession();
      throw toAppError(error);
    }

    // The retry carries the *new* token. Re-running the request interceptor
    // would do it, but doing it explicitly makes the guarantee visible — a
    // retry that replays the old header just 401s again.
    config.headers.set('Authorization', `Bearer ${pair.accessToken}`);
    return (await instance.request(config)) as never;
  };
}

function expireSession(): void {
  // Idempotent, and usually already done: `refreshSession` clears inside the
  // lock so that queued waiters see an empty store rather than each trying.
  tokenStore.clear();

  if (notifiedExpired) return;
  notifiedExpired = true;
  onSessionExpired();
}

export const api = createApiClient();
