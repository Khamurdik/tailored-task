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
- [ ] argon2id via `@node-rs/argon2` (prebuilt binaries, no node-gyp)
- [ ] `POST /auth/login` `{ email, password }` → `{ accessToken, refreshToken, user }`
- [ ] Compare against a dummy hash when the user does not exist, so the response
      time does not reveal whether the email is registered
- [ ] Identical response for wrong-password, unknown-email, and
      no-password-set (a Google-only user)
- [ ] `@nestjs/throttler` on login, keyed by IP **and** by email — per-IP alone
      lets a botnet spread attempts across one account

### Google login — secondary, links to an existing account
- [ ] `POST /auth/google` `{ idToken }` → same token pair as password login
- [ ] Verify the ID token with `google-auth-library`'s `OAuth2Client.verifyIdToken`,
      checking `aud` against our client id and `iss` against Google
- [ ] **Reject unless `email_verified === true`.** Without this check anyone who
      can obtain a Google token asserting an arbitrary unverified email can log
      in as that user. This is the single most important line in the module.
- [ ] Match to a user by NFC-normalized, case-insensitive email
- [ ] On first successful Google login, store `google_sub` on the user row.
      Match on `google_sub` first thereafter — a person can change the email on
      their Google account, and `sub` is the only stable identifier
- [ ] No match → the same generic failure as a bad password. Never
      "no account for this email", which turns Google login into a user oracle

### Tokens — localStorage, not cookies
- [ ] Access token, 15 min, returned in the response body, sent as
      `Authorization: Bearer`
- [ ] Refresh token returned in the response body and sent in the **JSON body**
      of `POST /auth/refresh`. No `Set-Cookie` anywhere in this module
- [ ] Rotate the refresh token on every use, with reuse detection: a replayed
      token invalidates the whole family
- [ ] Store only a SHA-256 of the refresh token; the plaintext lives on the
      client
- [ ] `POST /auth/logout` revokes the presented refresh token's family server
      side. Clearing localStorage alone is not logout
- [ ] `SessionGuard` populates `req.actor` from a Bearer JWT, or from
      `X-Share-Token`, or `null` — anonymous share visitors are legitimate callers

### Events
- [ ] Emit `user.authenticated` `{ userId, email }` after every successful
      login, password or Google. `sharing` uses it to bind pending
      email-addressed grants for users who were inserted by hand and so never
      produced a `user.created` event. Emitting rather than calling keeps this
      module below `sharing` in the layer graph

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

> **A successful XSS reads the token.** An httpOnly cookie is not readable from
> JavaScript; `localStorage` is. This trade is only acceptable alongside the
> mitigations below, and they are not optional.

- [ ] Strict CSP on the web app: no `unsafe-inline`, no `unsafe-eval`
- [ ] Never `dangerouslySetInnerHTML` with server or user data
- [ ] Access TTL stays at 15 minutes — it bounds the stolen-token window
- [ ] Refresh rotation with reuse detection stays, and is what makes a stolen
      refresh token detectable rather than silent
- [ ] Logout is server-side revocation, so a stolen token can be killed

## Invariants
- The guard never 401s on a missing token. Routes opt into requiring a user.
- No endpoint here reveals whether an email exists — not login, not Google, not
  refresh.
- No user row is ever created by this module. Zero calls to `UsersService.create`.
- An unverified Google email is never accepted.
- The refresh token in the database is a hash, never the token itself.

## Tests
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
