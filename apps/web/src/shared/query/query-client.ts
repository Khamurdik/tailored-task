import { MutationCache, QueryClient } from '@tanstack/react-query';

import { AppError } from '../errors/app-error';
import { queryKeys } from './keys';

/** Retrying these is pointless and, for a gone resource, actively rude. */
const TERMINAL_CODES = new Set(['NOT_FOUND', 'GONE', 'UNAUTHENTICATED', 'VALIDATION_FAILED']);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (!(error instanceof AppError)) return false;
  if (TERMINAL_CODES.has(error.code)) return false;
  return error.retryable;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    /**
     * **Every mutation invalidates the `['nodes']` prefix**, in one place,
     * rather than each mutation remembering to.
     *
     * A per-mutation invalidation list is where stale-UI bugs come from: move
     * and delete each touch several cache entries plus two ancestor chains,
     * and the one that gets missed shows up as a row that survives a refresh.
     * Doing it globally costs a refetch and is always correct — and being in
     * the cache config rather than in seven hooks means a new feature gets it
     * without knowing the rule exists.
     */
    mutationCache: new MutationCache({
      onSettled: (_data, _error, _variables, _context, mutation) => {
        const client = mutation.options.meta?.['queryClient'];
        if (client instanceof QueryClient) {
          void client.invalidateQueries({ queryKey: queryKeys.nodes.all });
        }
      },
    }),

    defaultOptions: {
      queries: {
        retry: shouldRetry,
        /**
         * Free pseudo-realtime. A data room is edited by a handful of people
         * over days, so a refetch when a tab regains focus solves most of the
         * stale-tree problem without websockets, a polling interval, or any
         * server work at all.
         */
        refetchOnWindowFocus: true,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/**
 * Signing out empties the cache rather than just clearing tokens.
 *
 * Leaving it populated means the next person to sign in on this machine sees
 * the previous user's tree rendered from cache before the first request
 * resolves — briefly, and completely.
 */
export function clearSession(client: QueryClient): void {
  client.cancelQueries().catch(() => undefined);
  client.clear();
}
