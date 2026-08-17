import type { AxiosInstance } from 'axios';

import { createMockAdapter, type MockAdapterOptions } from './adapter';
import { mockRoutes } from './router';

export { resetMockDb, mockDb } from './db';
export { mockRoutes } from './router';
export { createMockAdapter } from './adapter';

/**
 * Whether the placeholder data layer is active.
 *
 * Read in exactly one place, and **`PROD` wins over the flag**. A stray
 * `VITE_API_MODE=mock` in a production environment cannot serve fixtures to
 * real users; the worst it can do is nothing. That asymmetry is deliberate —
 * the failure mode of a mock left on in production is silent, plausible, wrong
 * data, which is the hardest kind of incident to notice.
 */
export function isMockMode(): boolean {
  if (import.meta.env.PROD) return false;
  return import.meta.env.VITE_API_MODE === 'mock';
}

/**
 * Swaps the axios adapter, if the mode says so. Returns whether it did, so the
 * caller can decide what to tell the developer.
 */
export function installMockTransport(
  instance: AxiosInstance,
  options?: MockAdapterOptions,
): boolean {
  if (!isMockMode()) return false;

  instance.defaults.adapter = createMockAdapter(options);

  // One line, because "why is my data not saving" is otherwise a long
  // afternoon — and the reverse, "why is the API not being called", is worse.
  console.info(
    `[mock] Placeholder data layer active — ${mockRoutes().length} routes, no network. ` +
      `Set VITE_API_MODE=live in apps/web/.env.local to talk to the real API.`,
  );

  return true;
}
