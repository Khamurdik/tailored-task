import { zodResolver } from '@hookform/resolvers/zod';
import { LoginRequestSchema, type LoginRequest } from '@dataroom/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';

import * as tokenStore from '@/shared/auth/token-store';
import { AppError } from '@/shared/errors/app-error';
import { describeError } from '@/shared/errors/messages';
import { Loader2 } from 'lucide-react';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, Label } from '@/shared/ui';

import * as authApi from './auth.api';
import { GoogleSignInButton } from './google-button';
import { useSession } from './session';

/**
 * One message for every credential failure.
 *
 * The API returns a single indistinguishable response for wrong-password,
 * unknown-email, and an account with no password set, specifically so the login
 * page cannot be used to discover which addresses are provisioned. Inventing a
 * more helpful client-side message — "we don't recognise that email" — undoes
 * that server-side care from the outside.
 */
const CREDENTIALS_FAILED = 'That email and password do not match an account.';

/**
 * Where to go after signing in.
 *
 * **Same-origin paths only.** `state.from` is attacker-influencable — a link to
 * `/login` with crafted state, or a history entry — and following it blindly is
 * an open redirect: sign in on the real site, land on a copy. Anything that is
 * not a plain absolute path is discarded rather than sanitised, because
 * "sanitised URL" is a category with a long history of bypasses.
 */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate === '') return '/';

  // Must start with exactly one slash. `//evil.com` is protocol-relative and
  // `/\evil.com` is treated as protocol-relative by some browsers.
  if (!candidate.startsWith('/')) return '/';
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return '/';

  // Reject anything carrying a scheme or a credential separator.
  if (/^\/[a-z][a-z\d+\-.]*:/i.test(candidate)) return '/';

  return candidate;
}

export function LoginPage() {
  const { user, isLoading, signIn } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<AppError | null>(null);

  const from = safeReturnPath((location.state as { from?: unknown } | null)?.from);

  const form = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  const signInMutation = useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    onSuccess: (result) => {
      tokenStore.set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      signIn(result.user);
      void navigate(from, { replace: true });
    },
    onError: (cause: unknown) => {
      setFormError(cause instanceof AppError ? cause : null);
      // Clear the password, keep the email. Retyping an address after a typo in
      // the password is pure friction; leaving a rejected password on screen is
      // shoulder-surfing surface for no benefit.
      form.setValue('password', '');
    },
  });

  // An already-signed-in user has no business on this screen. Rendering it
  // anyway invites them to sign in again over a working session.
  if (!isLoading && user !== null) return <Navigate to={from} replace />;

  const pending = signInMutation.isPending;

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Sign in</CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {formError !== null && <ErrorNotice error={formError} />}

          <form
            noValidate
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => {
              setFormError(null);
              // Trimmed here rather than in the schema: a pasted address very
              // often carries whitespace, and a validation error for something
              // invisible is the least explicable kind.
              signInMutation.mutate({ email: values.email.trim(), password: values.password });
            })}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={form.formState.errors.email !== undefined}
                aria-describedby={form.formState.errors.email ? 'email-error' : undefined}
                disabled={pending}
                {...form.register('email')}
              />
              {form.formState.errors.email !== undefined && (
                <p id="email-error" className="text-sm text-destructive">
                  Enter a valid email address.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                // Never a toggle to reveal it, and never `type=text`.
                type="password"
                autoComplete="current-password"
                aria-invalid={form.formState.errors.password !== undefined}
                aria-describedby={form.formState.errors.password ? 'password-error' : undefined}
                disabled={pending}
                {...form.register('password')}
              />
              {form.formState.errors.password !== undefined && (
                <p id="password-error" className="text-sm text-destructive">
                  Enter your password.
                </p>
              )}
            </div>

            {/*
              Disabled while in flight, so a second Enter cannot submit twice.

              The label stays "Sign in" throughout, and busy state is carried by
              `aria-busy` plus the spinner. Swapping the text for "Signing in…"
              was the first version and it changes the button's accessible name
              mid-action, so anyone listening loses track of which control they
              are on at exactly the wrong moment.
            */}
            <Button type="submit" className="w-full" disabled={pending} aria-busy={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Sign in
            </Button>
          </form>

          <GoogleSignInButton
            disabled={pending}
            onCredential={(idToken) => {
              setFormError(null);
              authApi
                .loginWithGoogle(idToken)
                .then((result) => {
                  tokenStore.set({
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                  });
                  signIn(result.user);
                  return navigate(from, { replace: true });
                })
                .catch((cause: unknown) => {
                  // The same generic message as a bad password. An unknown
                  // Google account must not be distinguishable here either.
                  setFormError(cause instanceof AppError ? cause : null);
                });
            }}
          />
        </CardContent>

        {/*
          Nothing else. No "create an account", no "forgot your password" — there
          is no registration endpoint and no reset flow, and a dead link on the
          login page is the first thing a reviewer clicks.
        */}
      </Card>
    </div>
  );
}

/**
 * A credentials failure gets the fixed sentence; everything else gets its own.
 *
 * The distinction matters to a user: "your password is wrong" and "we cannot
 * reach the server" call for completely different next actions, and collapsing
 * them into one message leaves both unactionable.
 */
function ErrorNotice({ error }: { error: AppError }) {
  if (error.kind === 'api' && error.code === 'UNAUTHENTICATED') {
    return <Alert tone="error">{CREDENTIALS_FAILED}</Alert>;
  }

  const recovery = describeError(error);
  return <Alert tone={error.kind === 'network' ? 'offline' : 'error'}>{recovery.message}</Alert>;
}

export { CREDENTIALS_FAILED };
