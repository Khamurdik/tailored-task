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
- [x] Login form, `react-hook-form` + the shared zod schemas
- [x] **No register form, no "create account" link, no forgot-password link**
      unless the flow behind it exists. The brief says not to ship
      unimplemented features, and a dead link on the login page is the first
      thing a reviewer clicks
- [x] A single generic error for any failed login. The API deliberately returns
      one response for wrong-password and unknown-email; do not invent a more
      specific message on the client and undo that
- [x] Disable submit while `isPending`

### Google login — secondary
- [x] `@react-oauth/google`, rendered under a `<GoogleOAuthProvider>` at the
      route level
- [x] Send the returned `credential` (an ID token) to `POST /auth/google`
- [x] Present it as "Sign in with Google", never "Sign up" — it cannot create
      an account, and labelling it as signup guarantees a support question
- [x] A Google identity with no matching user fails with the same generic
      message as a bad password. Do not special-case it into
      "no account for this email"
- [x] Hide the button entirely when `VITE_GOOGLE_CLIENT_ID` is unset, so a
      local checkout without Google credentials is not broken

### Session bootstrap
- [x] Read the token pair from `localStorage` on mount, call `/me` once, render
      nothing until it settles — a flash of the login screen for an
      authenticated user looks broken
- [x] Redirect to the originally requested URL after login, not to the root
- [x] Logout calls `POST /auth/logout` **before** clearing local state. Dropping
      the tokens client-side leaves the refresh family alive server-side; that
      is not a logout
- [x] Logout clears the query cache entirely

## Token storage

Tokens live in `localStorage`, written and read only through `shared`'s token
store — no component touches `localStorage` directly.

This is a deliberate trade, and the reasoning belongs in the README: no cookies
means CSRF cannot happen and mobile or native clients work unchanged, at the
cost of a successful XSS being able to read the token. The mitigations that
make that acceptable are a strict CSP and never rendering untrusted HTML — see
`apps/api/src/auth/TODO.md`.

- [x] `storage` event listener: a logout in one tab logs out the others
- [x] Treat a malformed or absent stored token as logged-out, never as an error
      screen. A half-written localStorage entry must not brick the app

## Invariants
- `ProtectedRoute` gates owner routes only. `/s/:token` must stay reachable
  while logged out — this is the single most common way the public share flow
  gets accidentally broken.
- Nothing in this feature can create a user.
- The refresh token is never sent as a query parameter — request bodies only,
  so it stays out of server logs and browser history.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/auth/TODO.md`](../../../../../tests/suites/web/auth/TODO.md) and implemented there — never in this module's folder.
- [ ] Reloading the page keeps you logged in
- [ ] An anonymous visit to a share link never touches the login screen
- [ ] A failed Google login and a failed password login render the same message
- [ ] Logout in one tab clears the session in a second tab

## Implementation notes

- [x] **The submit button keeps its label while pending.** Swapping the text for
      a spinner was the first version, and it changes the button's accessible
      name mid-action — anyone listening loses track of which control they are on
      at exactly the wrong moment. Busy state is `aria-busy` plus a spinner
      beside the unchanged label. `WEB-AUTH-004` caught it.
- [x] **The return path is validated, not sanitised** (`safeReturnPath`).
      `state.from` is attacker-influencable, and following it blindly is an open
      redirect — sign in on the real site, land on a copy. Anything that is not a
      plain single-slash absolute path is discarded, because "sanitised URL" is a
      category with a long history of bypasses. `WEB-AUTH-037`, `P0`.
- [x] **The cross-tab listener reacts to removals only.** A rotation also fires
      `storage` — every successful refresh writes a new pair — and treating those
      as news is how a refresh loop starts. A rotation needs no reaction, because
      the next request reads the store fresh anyway.
- [x] Bootstrap is deliberately **not** a react-query query. It runs once and its
      pending state gates the whole tree; a query's `isLoading` is also true on
      every later refetch, which must not blank the app.

## Done when
A seeded user logs in with a password, logs out, logs back in with Google to
the same account, and a page refresh in between keeps the session.
