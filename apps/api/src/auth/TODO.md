# auth — L2

## Purpose
Proves who the caller is. Issues and verifies sessions. Has no opinion about
what anyone is allowed to do.

## Owns
Password hashing, token issuance, `refresh_tokens` table, Google identity
linking.

## Public surface
- `SessionGuard` — resolves an actor or `null`, **never throws**
- `@RequireAuth()` — for routes that need a real user
- `@Actor()` — param decorator: `{ userId } | { shareToken } | null`
- `AuthController`: login, google, refresh, logout, me

## Depends on
`common`, `users`.

## Must not depend on
`access`, `nodes`, `sharing`. The moment this module reads a share grant, the
authn/authz boundary is gone.

## There is no registration

This system has no public signup. Accounts are provisioned out of band — see
`users/TODO.md`. That has three consequences this module must enforce:

1. **No `POST /auth/register`.** The route does not exist.
2. **Google login never creates a user.** It authenticates an existing one. A
   Google identity whose email matches no user row is rejected with the same
   response as a wrong password.
3. Every login path is a *lookup*, never an upsert.

## Responsibilities

### Password login — primary
- [x] argon2id via `@node-rs/argon2` (prebuilt binaries, no node-gyp)
- [x] `POST /auth/login` `{ email, password }` → `{ accessToken, refreshToken, user }`
- [x] Compare against a dummy hash when the user does not exist, so the response
      time does not reveal whether the email is registered
- [x] Identical response for wrong-password, unknown-email, and
      no-password-set (a Google-only user)
- [x] `@nestjs/throttler` on login, keyed by IP **and** by email — per-IP alone
      lets a botnet spread attempts across one account

### Google login — secondary, links to an existing account
- [x] `POST /auth/google` `{ idToken }` → same token pair as password login
- [x] Verify the ID token with `google-auth-library`'s `OAuth2Client.verifyIdToken`,
      checking `aud` against our client id and `iss` against Google
- [x] **Reject unless `email_verified === true`.** Without this check anyone who
      can obtain a Google token asserting an arbitrary unverified email can log
      in as that user. This is the single most important line in the module.
- [x] Match to a user by NFC-normalized, case-insensitive email
- [x] On first successful Google login, store `google_sub` on the user row.
      Match on `google_sub` first thereafter — a person can change the email on
      their Google account, and `sub` is the only stable identifier
- [x] No match → the same generic failure as a bad password. Never
      "no account for this email", which turns Google login into a user oracle

### Tokens — localStorage, not cookies
- [x] Access token, **1 day** (`JWT_ACCESS_TTL`), returned in the response body,
      sent as `Authorization: Bearer`. Refresh token 7 days
- [x] Refresh token returned in the response body and sent in the **JSON body**
      of `POST /auth/refresh`. No `Set-Cookie` anywhere in this module
- [x] Rotate the refresh token on every use, with reuse detection: a replayed
      token invalidates the whole family
- [x] Store only a SHA-256 of the refresh token; the plaintext lives on the
      client
- [x] `POST /auth/logout` revokes the presented refresh token's family server
      side. Clearing localStorage alone is not logout
- [x] `SessionGuard` populates `req.actor` from a Bearer JWT, or from
      `X-Share-Token`, or `null` — anonymous share visitors are legitimate callers

### Events
- [x] Emit `user.authenticated` `{ userId, email }` after every successful
      login, password or Google. `sharing` uses it to bind pending
      email-addressed grants, and since `user.created` turned out to be
      undeliverable — the seeder is a separate process — this is now the *only*
      binding trigger rather than the fallback behind one. Emitting rather than
      calling keeps this module below `sharing` in the layer graph

## Why no cookies

Bearer tokens in `localStorage` are a deliberate choice, and it buys two real
things:

- **CSRF stops existing.** There is no ambient credential for a browser to
  attach to a cross-site request, so the entire class is gone — along with the
  `SameSite=None` / double-submit-token problem that a Vercel-plus-App-Runner
  split would otherwise create.
- **Mobile and non-browser clients work unchanged.** A native app, a script, or
  a WebView gets the same auth as the web client with no cookie jar.

The cost is honest and must be written down rather than argued away:

> **A successful XSS reads both tokens.** An httpOnly cookie is not readable
> from JavaScript; `localStorage` is — and the refresh token lives there too, so
> what an attacker takes is seven days of access, not one day.

Be precise about which mitigations actually do work, because an earlier draft of
this file credited the access TTL with more than it delivers:

- [ ] Strict CSP on the web app: no `unsafe-inline`, no `unsafe-eval`.
      **This is the one that matters** — it is what stops the XSS, and every
      other item on this list is damage control after it has already failed
- [ ] Never `dangerouslySetInnerHTML` with server or user data
- [ ] Non-PDF uploads are never served `inline` (`storage/TODO.md`). Without
      that rule the bucket origin becomes an XSS vector the CSP cannot cover
- [ ] Refresh rotation with reuse detection, which makes a stolen refresh token
      *detectable* — after the fact, on the next legitimate refresh. Detection,
      not prevention
- [ ] Logout is server-side revocation of the refresh family

**What the access TTL does not do.** A JWT is not revocable; only the refresh
family is. At `JWT_ACCESS_TTL=1d`, logout — or a detected theft — leaves a
stolen access token working for up to 24 hours. The 1-day value is a deliberate
product choice (the churn of a 15-minute token is not worth paying for a bound
that a co-resident refresh token already defeats), but it must not be described
as bounding the exposure window. If that window ever needs to be real, the fix
is a server-side check against a revocation list on each request, not a shorter
TTL.

## Implementation notes

- [x] **`SessionGuard` attaches `{ shareToken }`, not a resolved grant.** Turning
      a credential into a grant id means reading `shares`, and the moment this
      module does that the authn/authz boundary is gone. `NodeAccessGuard`
      translates. The shared `RequestActor` type lives in `common` because both
      L2 modules need it and neither may import the other.
- [x] **Expiry is not a replay.** A `reused` outcome kills the family; an expired
      token is simply refused. Conflating them would revoke a family every time
      an idle user came back — a self-inflicted logout on the most ordinary path
      there is (`API-AUTH-027`).
- [x] **`user.authenticated` fires on login, not on refresh.** A rotation is not
      a login, and re-running the pending-grant claim on every refresh is
      pointless work on the hot path (`API-AUTH-028`).
- [x] **`/auth/logout` is deliberately not `@RequireAuth()`.** Someone whose
      access token has already expired still needs the family revoked — that is
      precisely when they most need it. Requiring a live session would leave the
      family alive for exactly the people most likely to have lost control of it.
- [x] A malformed login body returns the **credentials failure**, not a 400. A
      validation error tells a caller their guess had the wrong shape, and the
      response for a malformed body should not differ from a wrong password.
- [x] `expiresIn` is passed in **seconds**, not as `"1d"`. `@nestjs/jwt` types it
      against `ms`'s branded `StringValue`, so a plain config string does not fit;
      converting through this module's own parser keeps the format validated in
      one place.
- [x] The throttler is registered **globally** with `/health` opted out via
      `@SkipThrottle()`. App Runner polls it every ten seconds, and throttling the
      health check is how an instance gets marked unhealthy by its own rate
      limiter.

## Invariants
- The guard never 401s on a missing token. Routes opt into requiring a user.
- No endpoint here reveals whether an email exists — not login, not Google, not
  refresh.
- No user row is ever created by this module. Zero calls to `UsersService.create`.
- An unverified Google email is never accepted.
- The refresh token in the database is a hash, never the token itself.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/auth/TODO.md`](../../../../tests/suites/api/auth/TODO.md) and implemented there — never in this module's folder.
- [ ] Login → access a protected route → refresh → the old refresh token is dead
- [ ] Replaying a rotated refresh token invalidates the family
- [ ] Wrong password, unknown email, and a password-less user return
      byte-identical responses
- [ ] Google login for an email with no user row → generic failure, and **no
      user row is created** (assert the row count is unchanged)
- [ ] Google token with `email_verified: false` → rejected
- [ ] A seeded password user logs in with Google and gets the same `userId`
- [ ] `google_sub` match wins after the Google account's email changes
- [ ] Guard yields `null` (not 401) for an anonymous request
- [ ] No response from this module contains a `Set-Cookie` header

## Done when
A seeded user logs in with a password, logs in with Google against the same
account, survives a refresh cycle in the deployed environment, and an anonymous
request still reaches a controller with `actor === null`.
