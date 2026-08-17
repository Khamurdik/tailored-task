import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CREDENTIALS_FAILED, LoginPage, safeReturnPath } from '@web/features/auth/login-page';
import { SessionProvider } from '@web/features/auth/session';
import * as tokenStore from '@web/shared/auth/token-store';
import { createQueryClient } from '@web/shared/query/query-client';

/**
 * The login page, rendered for real.
 *
 * `api` is a module singleton, so its adapter is swapped rather than the module
 * mocked — that keeps the request interceptor, the error mapping, and the schema
 * parsing in the path, which is where most of what these assertions care about
 * actually happens.
 */
const { api } = await import('@web/shared/api/client');

interface Scenario {
  login?: (body: { email: string; password: string }) => AxiosResponse | AxiosError;
  google?: () => AxiosResponse | AxiosError;
}

const USER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  email: 'ana@example.com',
  name: 'Ana Ruiz',
  isAdmin: false,
};

function respond(status: number, data: unknown): AxiosResponse {
  const config = { headers: new AxiosHeaders() } as AxiosResponse['config'];
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config };
}

function reject(status: number, data: unknown): AxiosError {
  const response = respond(status, data);
  return new AxiosError(`status ${status}`, String(status), response.config, null, response);
}

const okLogin = () =>
  respond(200, { accessToken: 'access-1', refreshToken: 'refresh-1', user: USER });

function install(scenario: Scenario): { calls: string[] } {
  const calls: string[] = [];

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? '';
    calls.push(`${(config.method ?? 'get').toUpperCase()} ${url}`);
    await Promise.resolve();

    const body = typeof config.data === 'string' ? JSON.parse(config.data) : {};
    const outcome = url.endsWith('/auth/google')
      ? (scenario.google?.() ?? okLogin())
      : (scenario.login?.(body) ?? okLogin());

    if (outcome instanceof AxiosError) throw outcome;
    return outcome;
  };

  api.defaults.adapter = adapter;
  return { calls };
}

function renderLogin(initialEntry: { pathname: string; state?: unknown } = { pathname: '/login' }) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SessionProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Data rooms</div>} />
            <Route path="/rooms/abc" element={<div>Deep link target</div>} />
          </Routes>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const emailField = () => screen.getByLabelText('Email');
const passwordField = () => screen.getByLabelText('Password');
const submit = () => screen.getByRole('button', { name: /sign in/i });

beforeEach(() => {
  globalThis.localStorage.clear();
  vi.unstubAllEnvs();
});

describe('signing in with a password', () => {
  it('WEB-AUTH-014 a seeded user signs in and lands in the app', async () => {
    install({});
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    expect(await screen.findByText('Data rooms')).toBeInTheDocument();
    expect(tokenStore.get()?.accessToken).toBe('access-1');
  });

  it('WEB-AUTH-016 leading and trailing whitespace in the email is trimmed before submit', async () => {
    const seen: string[] = [];
    install({
      login: (body) => {
        seen.push(body.email);
        return okLogin();
      },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), '  ana@example.com  ');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    // A pasted address very often carries whitespace, and a validation error
    // for something invisible is the least explicable kind.
    await waitFor(() => expect(seen).toEqual(['ana@example.com']));
  });

  it('WEB-AUTH-017 an empty email shows a field error and issues no request', async () => {
    const { calls } = install({});
    const user = userEvent.setup();
    renderLogin();

    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('WEB-AUTH-018 an empty password shows a field error and issues no request', async () => {
    const { calls } = install({});
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.click(submit());

    expect(await screen.findByText(/enter your password/i)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('WEB-AUTH-019 a malformed email is caught client-side before the network', async () => {
    const { calls } = install({});
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'not-an-email');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('WEB-AUTH-022 the password input is type=password and never rendered as text', () => {
    install({});
    renderLogin();

    expect(passwordField()).toHaveAttribute('type', 'password');
    // No reveal toggle exists, so there is nothing that can flip it.
    expect(screen.queryByRole('button', { name: /show|reveal/i })).not.toBeInTheDocument();
  });

  it('WEB-AUTH-024 a wrong password leaves the typed email in place', async () => {
    install({ login: () => reject(401, { code: 'UNAUTHENTICATED', message: 'no' }) });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());

    await screen.findByText(CREDENTIALS_FAILED);
    // Retyping an address after a typo in the password is pure friction.
    expect(emailField()).toHaveValue('ana@example.com');
  });

  it('WEB-AUTH-025 a wrong password clears the password field', async () => {
    install({ login: () => reject(401, { code: 'UNAUTHENTICATED', message: 'no' }) });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());

    await screen.findByText(CREDENTIALS_FAILED);
    expect(passwordField()).toHaveValue('');
  });

  it('WEB-AUTH-004 submit is disabled while the request is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    api.defaults.adapter = async () => {
      await gate;
      return okLogin();
    };

    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    await waitFor(() => expect(submit()).toBeDisabled());
    release();
    expect(await screen.findByText('Data rooms')).toBeInTheDocument();
  });

  it('WEB-AUTH-021 two rapid Enter presses submit once', async () => {
    const { calls } = install({});
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    // Enter in the password field submits (WEB-AUTH-020), and the disabled
    // button is what stops the second one turning into a duplicate login.
    await user.keyboard('{Enter}{Enter}');

    await screen.findByText('Data rooms');
    expect(calls.filter((call) => call.includes('/auth/login'))).toHaveLength(1);
  });
});

describe('failure, offline, and server errors', () => {
  it('WEB-AUTH-003 a failed password login and a failed Google login render the same message', async () => {
    // The API returns one indistinguishable response for wrong-password,
    // unknown-email and an unknown Google identity. A client that invents a
    // more helpful message undoes that from the outside.
    install({ login: () => reject(401, { code: 'UNAUTHENTICATED', message: 'a' }) });
    const user = userEvent.setup();
    const { unmount } = renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());
    const passwordMessage = (await screen.findByRole('alert')).textContent;
    unmount();

    install({ google: () => reject(401, { code: 'UNAUTHENTICATED', message: 'b' }) });
    const { loginWithGoogle } = await import('@web/features/auth/auth.api');
    const googleError = await loginWithGoogle('unknown@example.com').catch(
      (cause: unknown) => cause,
    );

    const { describeError } = await import('@web/shared/errors/messages');
    expect(passwordMessage).toBe(CREDENTIALS_FAILED);
    // Both are UNAUTHENTICATED, so both reach the same branch and the same
    // sentence. Asserting the code rather than re-rendering keeps this test
    // about the property and not about the Google widget.
    expect((googleError as { code: string }).code).toBe('UNAUTHENTICATED');
    expect(describeError(googleError as never).action).toBe('sign-in');
  });

  it('WEB-AUTH-031 a 500 renders a retryable error, not a field validation error', async () => {
    install({ login: () => reject(500, { code: 'INTERNAL', message: 'boom' }) });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/something went wrong on our side/i);
    expect(alert).not.toHaveTextContent(CREDENTIALS_FAILED);
    expect(screen.queryByText(/valid email address/i)).not.toBeInTheDocument();
  });

  it('WEB-AUTH-032 an offline submit renders a distinct "cannot reach the server" message', async () => {
    api.defaults.adapter = () => Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    // "Check your connection" and "your password is wrong" call for completely
    // different next actions.
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline|connection/i);
  });

  it('WEB-AUTH-033 a rate-limited login renders the wait, not a generic failure', async () => {
    install({ login: () => reject(429, { code: 'RATE_LIMITED', message: 'slow down' }) });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a moment/i);
  });

  it('WEB-AUTH-034 a failed submit re-enables the form', async () => {
    install({ login: () => reject(401, { code: 'UNAUTHENTICATED', message: 'no' }) });
    const user = userEvent.setup();
    renderLogin();

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'wrong');
    await user.click(submit());

    await screen.findByText(CREDENTIALS_FAILED);
    // A form left disabled after a failure is a dead end — the user can see
    // what went wrong and cannot act on it.
    expect(submit()).toBeEnabled();
    expect(emailField()).toBeEnabled();
  });
});

describe('landing in the right place', () => {
  it('WEB-AUTH-035 a deep link visited while logged out returns to that link after sign-in', async () => {
    install({});
    const user = userEvent.setup();
    renderLogin({ pathname: '/login', state: { from: '/rooms/abc' } });

    await user.type(emailField(), 'ana@example.com');
    await user.type(passwordField(), 'change-me-now');
    await user.click(submit());

    expect(await screen.findByText('Deep link target')).toBeInTheDocument();
  });

  it('WEB-AUTH-036 the return path preserves query parameters and hash', () => {
    expect(safeReturnPath('/rooms/abc?page=2#section')).toBe('/rooms/abc?page=2#section');
  });

  it('WEB-AUTH-037 a return path pointing at another origin is ignored — no open redirect', () => {
    // Sign in on the real site, land on a copy. `state.from` is
    // attacker-influencable, so anything that is not a plain absolute path is
    // discarded rather than sanitised.
    for (const hostile of [
      'https://evil.example/steal',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/javascript:alert(1)',
      'http://localhost:5173/ok',
      '',
      null,
      undefined,
      42,
    ]) {
      expect(safeReturnPath(hostile), String(hostile)).toBe('/');
    }

    // Ordinary paths still work — the guard must not break the feature it
    // protects.
    expect(safeReturnPath('/rooms/abc')).toBe('/rooms/abc');
  });

  it('WEB-AUTH-038 an already-signed-in user visiting the login route is redirected into the app', async () => {
    tokenStore.set({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    api.defaults.adapter = (config) =>
      Promise.resolve({ ...respond(200, USER), config } as AxiosResponse);

    renderLogin();

    // Inviting someone to sign in over a working session is how a user ends up
    // with two sessions and no idea which one they are using.
    expect(await screen.findByText('Data rooms')).toBeInTheDocument();
  });
});

describe('what is deliberately absent', () => {
  it('WEB-AUTH-001 the login page renders no register or sign-up link', () => {
    install({});
    renderLogin();

    // There is no registration endpoint, so a link to one cannot work. This is
    // the first thing a reviewer clicks.
    expect(screen.queryByText(/create an account|sign up|register/i)).not.toBeInTheDocument();
  });

  it('WEB-AUTH-046 no password-reset affordance is rendered while no reset flow exists', () => {
    install({});
    renderLogin();

    expect(screen.queryByText(/forgot|reset your password/i)).not.toBeInTheDocument();
  });

  it('WEB-AUTH-002 the login page renders no link to an unimplemented flow', () => {
    install({});
    renderLogin();

    // Every anchor on this page must go somewhere real. Today there are none,
    // and asserting that is cheaper than auditing them later.
    expect(screen.queryAllByRole('link')).toEqual([]);
  });

  it('WEB-AUTH-010 the Google button is absent when VITE_GOOGLE_CLIENT_ID is unset', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    install({});
    renderLogin();

    // Absent, not disabled. A checkout without Google credentials has to run,
    // and a disabled button that never explains itself is worse than none.
    expect(screen.queryByText(/^or$/i)).not.toBeInTheDocument();
  });
});
