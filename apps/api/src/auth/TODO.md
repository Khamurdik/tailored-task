# auth — L2

## Purpose
Proves who the caller is. Issues and verifies sessions. Has no opinion about
what anyone is allowed to do.

## Owns
Password hashing, token issuance, the refresh cookie, `refresh_tokens` table.

## Public surface
- `SessionGuard` — resolves an actor or `null`, **never throws**
- `@RequireAuth()` — for routes that need a real user
- `@Actor()` — param decorator: `{ userId } | { shareToken } | null`
- `AuthController`: register, login, refresh, logout, me

## Depends on
`common`, `users`.

## Must not depend on
`access`, `nodes`, `sharing`. The moment this module reads a share grant, the
authn/authz boundary is gone.

## Responsibilities
- [ ] argon2id hashing with sane params
- [ ] Access token, 15 min, returned in the body and sent as `Authorization: Bearer`
- [ ] Refresh token in an httpOnly cookie, rotated on every use, with reuse
      detection (a replayed token invalidates the family)
- [ ] `SessionGuard` populates `req.actor` from a JWT, or from `X-Share-Token`,
      or `null` — anonymous share visitors are legitimate callers
- [ ] Identical response for wrong-password and no-such-user (email enumeration)
- [ ] `@nestjs/throttler` on login and register
- [ ] Google OAuth — **only if time remains**, after everything else ships

## Invariants
- The guard never 401s on a missing token. Routes opt into requiring a user.
- No endpoint here reveals whether an email is registered.

## Cookie trap
Frontend on Vercel and API on App Runner are different registrable domains, so
the refresh cookie needs `SameSite=None; Secure`, which reopens CSRF on the
refresh route.

Preferred fix: a Vercel rewrite proxying `/api/*` to App Runner. Cookies become
first-party, `SameSite=Lax` works, CSRF and CORS both disappear. Ten lines in
`vercel.json`. Take this option unless something forces otherwise; the
alternative is a double-submit CSRF token on the refresh route.

## Tests
- [ ] Register → login → refresh → access protected route
- [ ] Replaying a rotated refresh token invalidates the family
- [ ] Wrong password and unknown email return byte-identical responses
- [ ] Guard yields `null` (not 401) for an anonymous request

## Done when
A session survives a refresh cycle in the deployed environment, and an
anonymous request reaches a controller with `actor === null`.
