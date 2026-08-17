import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProtectedRoute, AdminRoute } from '@web/features/auth/protected-route';
import { SessionProvider, useSession } from '@web/features/auth/session';
import * as tokenStore from '@web/shared/auth/token-store';
import { queryKeys } from '@web/shared/query/keys';
import { createQueryClient } from '@web/shared/query/query-client';

const { api } = await import('@web/shared/api/client');

const USER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'ana@example.com',
  name: 'Ana Ruiz',
  isAdmin: false,
};

const respond = (status: number, data: unknown): AxiosResponse => {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
};

function renderApp(options: {
  adapter: AxiosAdapter;
  entry?: string;
  client?: QueryClient;
}) {
  api.defaults.adapter = options.adapter;
  const queryClient = options.client ?? createQueryClient();

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options.entry ?? '/']}>
          <SessionProvider>
            <Routes>
              <Route path="/login" element={<div>Login screen</div>} />

              {/* Public, and deliberately outside ProtectedRoute. */}
              <Route path="/s/:code" element={<div>Shared with you</div>} />

              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <OwnerHome />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/jobs"
                element={
                  <AdminRoute>
                    <div>Jobs console</div>
                  </AdminRoute>
                }
              />
            </Routes>
          </SessionProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function OwnerHome() {
  const { user, signOut } = useSession();
  return (
    <div>
      <p>Signed in as {user?.email}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.unstubAllEnvs();
});

describe('route protection and bootstrap', () => {
  it('WEB-AUTH-012 ProtectedRoute redirects an anonymous user away from an owner route', async () => {
    renderApp({ adapter: () => Promise.reject(new AxiosError('should not be called')) });

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('WEB-AUTH-013 ProtectedRoute never gates /s/:code', async () => {
    // The single most common way the public share flow gets broken, and it
    // fails silently for whoever built it because they are always signed in.
    const calls: string[] = [];
    renderApp({
      entry: '/s/H7QK4M2XR9TB5WVN',
      adapter: (config) => {
        calls.push(config.url ?? '');
        return Promise.reject(new AxiosError('no session here'));
      },
    });

    expect(await screen.findByText('Shared with you')).toBeInTheDocument();
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    // And no session bootstrap was attempted, so an anonymous visitor never
    // even touches /auth/me.
    expect(calls).toEqual([]);
  });

  it('WEB-AUTH-005 bootstrap renders nothing until /me settles — no flash of the login screen', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    let release: (value: AxiosResponse) => void = () => undefined;
    const pending = new Promise<AxiosResponse>((resolve) => {
      release = resolve;
    });

    renderApp({ adapter: () => pending });

    // A stored token means "probably signed in". Rendering the login screen
    // while finding out produces a flash of it on every reload for every
    // authenticated user, which reads as broken rather than as fast.
    expect(screen.queryByText('Login screen')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();

    release(respond(200, USER));
    expect(await screen.findByText(/signed in as ana@example.com/i)).toBeInTheDocument();
  });

  it('WEB-AUTH-039 a full page reload keeps the session', async () => {
    // "Reload" is a fresh mount reading the same storage — which is exactly
    // what a reload is, once the tokens are already there.
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    const first = renderApp({ adapter: (config) => Promise.resolve({ ...respond(200, USER), config }) });
    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    first.unmount();

    renderApp({ adapter: (config) => Promise.resolve({ ...respond(200, USER), config }) });
    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
  });

  it('WEB-AUTH-041 a failed refresh on first load lands on login with no flash of app content', async () => {
    tokenStore.set({ accessToken: 'dead', refreshToken: 'dead' });

    renderApp({
      adapter: (config) => {
        const response = respond(401, { code: 'UNAUTHENTICATED', message: 'no' });
        return Promise.reject(
          new AxiosError('401', '401', config as AxiosResponse['config'], null, response),
        );
      },
    });

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    // Never rendered, not "rendered then replaced" — a flash of owner content
    // for someone who is not signed in is worse than a slow load.
    expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
  });

  it('WEB-AUTH-044 a corrupted token in storage reads as logged out, never as a crash', async () => {
    globalThis.localStorage.setItem('dataroom.tokens', '{"accessToken":');
    const calls: string[] = [];

    renderApp({
      adapter: (config) => {
        calls.push(config.url ?? '');
        return Promise.resolve({ ...respond(200, USER), config });
      },
    });

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    // A half-written entry must not brick the app, and must not produce a
    // pointless request either.
    expect(calls).toEqual([]);
  });

  it('WEB-AUTH-043 tokens cleared in another tab log this tab out', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    renderApp({ adapter: (config) => Promise.resolve({ ...respond(200, USER), config }) });

    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();

    // What the browser dispatches in *other* tabs on a `removeItem`. Only
    // removals count — a rotation also fires this event, and reacting to those
    // is how a refresh loop starts.
    globalThis.dispatchEvent(
      new StorageEvent('storage', { key: 'dataroom.tokens', newValue: null, oldValue: 'x' }),
    );

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('WEB-AUTH-049 an admin-only route is hidden from a non-admin rather than shown and rejected', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    renderApp({
      entry: '/jobs',
      adapter: (config) => Promise.resolve({ ...respond(200, { ...USER, isAdmin: false }), config }),
    });

    // Showing a non-admin a page that then refuses them tells them it exists,
    // which is the same enumeration leak the API avoids by answering 404
    // rather than 403.
    expect(await screen.findByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.queryByText('Jobs console')).not.toBeInTheDocument();
  });
});

describe('signing out', () => {
  it('WEB-AUTH-007 logout calls the API before clearing local state', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const order: string[] = [];

    renderApp({
      adapter: (config) => {
        const url = config.url ?? '';
        if (url.endsWith('/auth/logout')) {
          // Read the store at the moment the call is made. Clearing first would
          // leave the refresh family alive server-side, so anyone holding a
          // stolen token keeps minting access tokens for another seven days.
          order.push(tokenStore.get() === null ? 'cleared-first' : 'called-with-token');
        }
        return Promise.resolve({ ...respond(200, USER), config });
      },
    });

    await screen.findByText(/signed in as/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(screen.getByText('Login screen')).toBeInTheDocument());
    expect(order).toEqual(['called-with-token']);
    expect(tokenStore.get()).toBeNull();
  });

  it('WEB-AUTH-048 logout still clears local state when the API call fails', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });

    renderApp({
      adapter: (config) => {
        if ((config.url ?? '').endsWith('/auth/logout')) {
          return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK'));
        }
        return Promise.resolve({ ...respond(200, USER), config });
      },
    });

    await screen.findByText(/signed in as/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }));

    // A user who pressed "sign out" has to end up signed out of this browser
    // whatever the network did. Leaving them apparently signed in is the worse
    // of the two failures.
    await waitFor(() => expect(tokenStore.get()).toBeNull());
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('WEB-AUTH-008 logout clears the query cache', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    const client = createQueryClient();
    client.setQueryData(queryKeys.nodes.detail('abc'), { name: 'Confidential.pdf' });

    renderApp({
      client,
      adapter: (config) => Promise.resolve({ ...respond(200, USER), config }),
    });

    await screen.findByText(/signed in as/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }));

    // Otherwise the next person to sign in on this machine sees the previous
    // user's tree rendered from cache before the first request resolves.
    await waitFor(() => expect(client.getQueryData(queryKeys.nodes.detail('abc'))).toBeUndefined());
  });

  it('WEB-AUTH-045 the browser back button after sign-out shows no cached app content', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    renderApp({ adapter: (config) => Promise.resolve({ ...respond(200, USER), config }) });

    await screen.findByText(/signed in as/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }));
    await screen.findByText('Login screen');

    // Going back re-renders the owner route, and the guard must re-evaluate
    // rather than trusting whatever the router had mounted.
    globalThis.history.back();

    await waitFor(() => expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument());
  });
});
