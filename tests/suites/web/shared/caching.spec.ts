import type { ErrorCode } from '@dataroom/shared';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { AppError } from '@web/shared/errors/app-error';
import { queryKeys } from '@web/shared/query/keys';
import { clearSession, createQueryClient, shouldRetry } from '@web/shared/query/query-client';

const apiError = (code: ErrorCode) => new AppError('api', code, 'message', 404);

describe('caching and freshness', () => {
  it('WEB-SHARED-011 404 and 410 are not retried', () => {
    expect(shouldRetry(0, apiError('NOT_FOUND'))).toBe(false);
    expect(shouldRetry(0, apiError('GONE'))).toBe(false);

    // Not blanket-off: a 500 and a rate limit are worth one more attempt, and
    // a rule that never retries makes a flaky connection look like an outage.
    expect(shouldRetry(0, apiError('INTERNAL'))).toBe(true);
    expect(shouldRetry(0, apiError('RATE_LIMITED'))).toBe(true);

    // But not forever.
    expect(shouldRetry(2, apiError('INTERNAL'))).toBe(false);

    // A network failure is retryable; an unrecognised throw is not, because
    // nothing is known about whether repeating it is safe.
    expect(shouldRetry(0, new AppError('network', 'INTERNAL', 'offline', null))).toBe(true);
    expect(shouldRetry(0, new Error('something else'))).toBe(false);
  });

  it('WEB-SHARED-012 every mutation invalidates the [nodes] prefix', async () => {
    const client = createQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.resolve('done'),
        meta: { queryClient: client },
      })
      .execute(undefined);

    // Wholesale, and from the cache config rather than from each hook. A
    // precise invalidation graph for move and delete has to know both ancestor
    // chains and every open page of each; the one that gets missed is a row
    // that survives a refresh.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.nodes.all });
  });

  it('WEB-SHARED-025 refocusing the window refetches active queries', () => {
    const client = createQueryClient();

    // Free pseudo-realtime: a data room is edited by a handful of people over
    // days, so refetch-on-focus solves most of the stale-tree problem with no
    // websocket and no polling interval.
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
  });

  it('WEB-SHARED-026 logging out empties the cache so the next user sees nothing stale', () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.nodes.detail('abc'), { name: 'Confidential.pdf' });
    expect(client.getQueryData(queryKeys.nodes.detail('abc'))).toBeDefined();

    clearSession(client);

    // Otherwise the next person to sign in on this machine sees the previous
    // user's tree rendered from cache before the first request resolves.
    expect(client.getQueryData(queryKeys.nodes.detail('abc'))).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('query keys', () => {
  it("WEB-SHARED-044 a share view's query keys are namespaced by token and never collide with an owner's", () => {
    // The structural half of WEB-SHARED-026. Sharing a cache entry between the
    // owner view and a share view is *the* mechanism by which private data
    // reaches a public page, and it happens the moment both spell
    // `nodes.children(id)` for the same id.
    const owner = queryKeys.nodes.children('node-1');
    const visitor = queryKeys.share('token-a').children('node-1');
    const other = queryKeys.share('token-b').children('node-1');

    expect(visitor).not.toEqual(owner);
    expect(visitor).not.toEqual(other);
    expect(visitor[0]).toBe('share');

    // And a share key is not under the ['nodes'] prefix, so an owner-side
    // invalidation cannot reach into a visitor's cache either.
    expect(owner[0]).toBe('nodes');
  });
});
