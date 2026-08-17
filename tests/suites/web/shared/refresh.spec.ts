import {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiClient, setSessionExpiredHandler } from '@web/shared/api/client';
import { resetRefreshState } from '@web/shared/api/refresh';
import { setShareToken } from '@web/shared/auth/share-session';
import * as tokenStore from '@web/shared/auth/token-store';

/**
 * A scripted server.
 *
 * `unauthorizedUntilRefreshed` is the shape that matters: protected reads 401
 * while the stored access token is the stale one, and succeed once a refresh
 * has issued a new one. That is what makes "the retry carried the new token"
 * an observable outcome rather than an inspection of internals.
 */
function scriptedClient(options: {
  refresh?: (attempt: number) => AxiosResponse | AxiosError;
  protectedStatus?: (accessToken: string | undefined) => number;
} = {}) {
  const calls = { refresh: 0, protected: 0 };

  const respond = (config: InternalAxiosRequestConfig, status: number, data: unknown) => {
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: new AxiosHeaders(),
      config: config as AxiosResponse['config'],
    };
    if (status >= 400) {
      throw new AxiosError(`status ${status}`, String(status), config, null, response);
    }
    return response;
  };

  const adapter: AxiosAdapter = async (config) => {
    const internal = config as InternalAxiosRequestConfig;
    await Promise.resolve();

    if ((config.url ?? '').endsWith('/auth/refresh')) {
      calls.refresh += 1;
      const scripted = options.refresh?.(calls.refresh);
      if (scripted instanceof AxiosError) throw scripted;
      if (scripted !== undefined) return scripted;
      return respond(internal, 200, {
        accessToken: `access-${calls.refresh + 1}`,
        refreshToken: `refresh-${calls.refresh + 1}`,
      });
    }

    calls.protected += 1;
    const bearer = internal.headers.get('Authorization');
    const token = typeof bearer === 'string' ? bearer.replace('Bearer ', '') : undefined;
    const status = options.protectedStatus?.(token) ?? (token === 'access-1' ? 401 : 200);
    return respond(internal, status, status === 200 ? { ok: true, sawToken: token } : { code: 'UNAUTHENTICATED', message: 'no' });
  };

  const client = createApiClient();
  client.defaults.adapter = adapter;
  return { client, calls };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  setShareToken(null);
  resetRefreshState();
  setSessionExpiredHandler(() => undefined);
  tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
});

describe('refreshing a session', () => {
  it('WEB-SHARED-003 a 401 triggers one refresh and one retry of the original request', async () => {
    const { client, calls } = scriptedClient();

    const response = await client.get('/nodes');

    expect(response.status).toBe(200);
    expect(calls.refresh).toBe(1);
    expect(calls.protected).toBe(2); // the original, then the retry
  });

  it('WEB-SHARED-004 ten simultaneous 401s trigger exactly one refresh call and all ten succeed', async () => {
    const { client, calls } = scriptedClient();

    // The failure this guards against does not reproduce on a slow
    // single-request page: N refreshes rotate the token N times, and every
    // rotation after the first replays an already-rotated token, which the
    // server treats as theft and answers by killing the family.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => client.get('/nodes')),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(calls.refresh).toBe(1);
  });

  it('WEB-SHARED-028 two contexts hitting 401 together produce one refresh between them, and neither is logged out', async () => {
    // Two client instances standing in for two tabs. They share one
    // `localStorage` and therefore one refresh token, which is exactly why a
    // per-tab promise is not enough — each would start its own "single" flight
    // and the second would replay.
    let refreshes = 0;
    const build = () => {
      const { client, calls } = scriptedClient({
        refresh: () => {
          refreshes += 1;
          return {
            data: { accessToken: 'access-2', refreshToken: 'refresh-2' },
            status: 200,
            statusText: '200',
            headers: new AxiosHeaders(),
            config: {} as AxiosResponse['config'],
          };
        },
      });
      return { client, calls };
    };

    const tabA = build();
    const tabB = build();

    const [a, b] = await Promise.all([tabA.client.get('/nodes'), tabB.client.get('/nodes')]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(refreshes, 'one refresh between two tabs').toBe(1);
    expect(tokenStore.get()?.refreshToken).toBe('refresh-2');
  });

  it('WEB-SHARED-029 a waiter that acquires the refresh lock second re-reads the rotated pair instead of refreshing again', async () => {
    const { client, calls } = scriptedClient();

    await Promise.all([client.get('/nodes'), client.get('/nodes/other')]);

    // The lock serialises; it does not deduplicate. A waiter that refreshes
    // anyway *is* the replay this design exists to prevent, so the second one
    // must notice the token changed while it queued and use that.
    expect(calls.refresh).toBe(1);
    expect(tokenStore.get()?.accessToken).toBe('access-2');
  });

  it('WEB-SHARED-016 the retried request carries the new token, not the old one', async () => {
    const { client } = scriptedClient();

    const response = await client.get('/nodes');

    expect(response.data.sawToken).toBe('access-2');
  });

  it('WEB-SHARED-015 a request that 401s twice is not retried a third time', async () => {
    // The server keeps rejecting even after a successful refresh — a revoked
    // session, say. Without the retry guard this recurses until the stack ends.
    const { client, calls } = scriptedClient({ protectedStatus: () => 401 });

    await expect(client.get('/nodes')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(calls.protected).toBe(2);
    expect(calls.refresh).toBe(1);
  });

  it('WEB-SHARED-017 a 401 on the refresh endpoint itself does not recurse', async () => {
    const { client, calls } = scriptedClient({
      refresh: () => new AxiosError('unauthorized', '401'),
    });

    await expect(client.get('/nodes')).rejects.toBeDefined();
    expect(calls.refresh).toBe(1);
  });

  it('WEB-SHARED-018 a non-401 error is never retried by the refresh path', async () => {
    const { client, calls } = scriptedClient({ protectedStatus: () => 500 });

    await expect(client.get('/nodes')).rejects.toMatchObject({ status: 500 });
    expect(calls.refresh).toBe(0);
    expect(calls.protected).toBe(1);
  });

  it('WEB-SHARED-005 a failed refresh clears the store once and redirects, without looping', async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);

    const { client } = scriptedClient({
      refresh: () => new AxiosError('unauthorized', '401'),
    });

    // A burst, so a per-request redirect would fire five times and the
    // navigations would interrupt each other.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => client.get('/nodes')),
    );

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(tokenStore.get()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('WEB-SHARED-043 an anonymous share visitor who gets a 401 is never sent to the login page', async () => {
    // The refresh path seen from the other side: a visitor has no session to
    // refresh, and bouncing them to a login page they have no business seeing
    // is the bug.
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    tokenStore.clear();
    setShareToken('a-share-credential');

    const { client, calls } = scriptedClient({ protectedStatus: () => 401 });

    await expect(client.get('/nodes/abc')).rejects.toBeDefined();
    expect(calls.refresh).toBe(0);
    expect(expired).not.toHaveBeenCalled();
  });
});
