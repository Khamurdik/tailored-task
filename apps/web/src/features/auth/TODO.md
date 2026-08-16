# web/features/auth

## Purpose
Login and session bootstrap. There is no registration screen — accounts are
provisioned server-side, so this feature only ever authenticates an existing
user.

## Owns
Client session state and the stored token pair.

## Public surface
- `<ProtectedRoute>`
- `useSession()` → `{ user, isLoading }`
- `<LoginPage>` — the only unauthenticated owner-facing route

## Depends on
`shared`.

## Responsibilities

### Password login — primary
- [ ] Login form, `react-hook-form` + the shared zod schemas
- [ ] **No register form, no "create account" link, no forgot-password link**
      unless the flow behind it exists. The brief says not to ship
      unimplemented features, and a dead link on the login page is the first
      thing a reviewer clicks
- [ ] A single generic error for any failed login. The API deliberately returns
      one response for wrong-password and unknown-email; do not invent a more
      specific message on the client and undo that
- [ ] Disable submit while `isPending`

### Google login — secondary
- [ ] `@react-oauth/google`, rendered under a `<GoogleOAuthProvider>` at the
      route level
- [ ] Send the returned `credential` (an ID token) to `POST /auth/google`
- [ ] Present it as "Sign in with Google", never "Sign up" — it cannot create
      an account, and labelling it as signup guarantees a support question
- [ ] A Google identity with no matching user fails with the same generic
      message as a bad password. Do not special-case it into
      "no account for this email"
- [ ] Hide the button entirely when `VITE_GOOGLE_CLIENT_ID` is unset, so a
      local checkout without Google credentials is not broken

### Session bootstrap
- [ ] Read the token pair from `localStorage` on mount, call `/me` once, render
      nothing until it settles — a flash of the login screen for an
      authenticated user looks broken
- [ ] Redirect to the originally requested URL after login, not to the root
- [ ] Logout calls `POST /auth/logout` **before** clearing local state. Dropping
      the tokens client-side leaves the refresh family alive server-side; that
      is not a logout
- [ ] Logout clears the query cache entirely

## Token storage

Tokens live in `localStorage`, written and read only through `shared`'s token
store — no component touches `localStorage` directly.

This is a deliberate trade, and the reasoning belongs in the README: no cookies
means CSRF cannot happen and mobile or native clients work unchanged, at the
cost of a successful XSS being able to read the token. The mitigations that
make that acceptable are a strict CSP and never rendering untrusted HTML — see
`apps/api/src/auth/TODO.md`.

- [ ] `storage` event listener: a logout in one tab logs out the others
- [ ] Treat a malformed or absent stored token as logged-out, never as an error
      screen. A half-written localStorage entry must not brick the app

## Invariants
- `ProtectedRoute` gates owner routes only. `/s/:token` must stay reachable
  while logged out — this is the single most common way the public share flow
  gets accidentally broken.
- Nothing in this feature can create a user.
- The refresh token is never sent as a query parameter — request bodies only,
  so it stays out of server logs and browser history.

## Tests
- [ ] Reloading the page keeps you logged in
- [ ] An anonymous visit to a share link never touches the login screen
- [ ] A failed Google login and a failed password login render the same message
- [ ] Logout in one tab clears the session in a second tab

## Done when
A seeded user logs in with a password, logs out, logs back in with Google to
the same account, and a page refresh in between keeps the session.
