import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Runs before every file in the `web-unit` project.
 */

/**
 * `cleanup` unmounts anything left rendered. Without it, `getByRole` starts
 * matching a component from a previous test and the failure appears in
 * whichever test happens to run second — the classic "passes alone, fails in
 * the suite".
 */
afterEach(() => {
  cleanup();
});

/**
 * A minimal `localStorage`, because there is not one in this environment.
 *
 * Observed rather than assumed: under Node 26 + jsdom 30, both
 * `globalThis.localStorage` and `window.localStorage` are `undefined`, and Node
 * prints `localStorage is not available because --localstorage-file was not
 * provided` — its own experimental Web Storage global, which has no backing
 * file and shadows the one jsdom would otherwise supply.
 *
 * The app survives this: `token-store.ts` optional-chains and try/catches
 * every access, so a browser with storage blocked degrades to a tab-lifetime
 * session rather than crashing. But "there is never any storage" is not the
 * condition the token tests are about, and without this they would all pass by
 * asserting nothing.
 */
if (globalThis.localStorage === undefined) {
  const entries = new Map<string, string>();

  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };

  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

/**
 * A minimal Web Locks implementation, because jsdom has none.
 *
 * This is not decoration. The client's refresh path is built on
 * `navigator.locks` precisely because it is the one primitive that spans tabs
 * of a browser profile, and the two `P0` declarations in `web/shared`
 * (`WEB-SHARED-004`, `WEB-SHARED-028`) are about exactly that behaviour. With
 * no lock manager the client takes its documented fallback — a per-tab promise
 * — and the cross-context test would silently assert the weaker guarantee.
 *
 * One shared queue per name, in one realm, is a faithful model of what the
 * browser gives two tabs of one profile: requests are serialised in arrival
 * order, and the lock is released when the callback settles.
 *
 * It implements only `request(name, callback)`. The real API also takes an
 * options object with `mode`, `ifAvailable`, `steal` and a signal; none is
 * used by this codebase, and stubbing them would be inventing behaviour to
 * test against.
 */
type LockCallback<T> = () => Promise<T>;

if (globalThis.navigator !== undefined && !('locks' in globalThis.navigator)) {
  const queues = new Map<string, Promise<unknown>>();

  const locks = {
    async request<T>(name: string, callback: LockCallback<T>): Promise<T> {
      const previous = queues.get(name) ?? Promise.resolve();

      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      queues.set(
        name,
        previous.then(() => held),
      );

      // Wait for whoever is ahead of us, then run holding the lock.
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };

  Object.defineProperty(globalThis.navigator, 'locks', {
    value: locks,
    configurable: true,
  });
}
