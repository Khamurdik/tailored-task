# api/auth

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/auth/TODO.md`](../../../../apps/api/src/auth/TODO.md)

Two things dominate: nothing may reveal whether an email exists, and no login
path may ever create a user.

## Declared tests

### Password sign-in

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-AUTH-001 | A seeded user logs in with email and password | integration | P0 |
| API-AUTH-002 | `POST /auth/register` does not exist — 404 from the router | security | P0 |
| API-AUTH-003 | Wrong password and unknown email return byte-identical responses | security | P0 |
| API-AUTH-004 | A user with a null `password_hash` fails password login identically | security | P0 |
| API-AUTH-005 | Login timing does not distinguish unknown email from wrong password | security | P1 |

### Tokens and sessions

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-AUTH-006 | A valid access token reaches a protected route | integration | P0 |
| API-AUTH-007 | Refresh rotates the pair and the old refresh token stops working | integration | P0 |
| API-AUTH-008 | Replaying a rotated refresh token invalidates the whole family | security | P0 |
| API-AUTH-009 | Logout revokes the family server-side, not just on the client | security | P0 |
| API-AUTH-010 | The stored refresh token is a hash, never the token itself | security | P0 |
| API-AUTH-011 | No response from this module carries a `Set-Cookie` header | security | P0 |
| API-AUTH-012 | The refresh token is accepted in the request body and rejected as a query parameter | security | P0 |
| API-AUTH-013 | `SessionGuard` yields `actor === null` for an anonymous request rather than 401 | integration | P0 |
| API-AUTH-014 | `SessionGuard` resolves an actor from `X-Share-Token` | integration | P0 |

### Google sign-in and account linking

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-AUTH-015 | Google login succeeds for a seeded user whose verified email matches | integration | P0 |
| API-AUTH-016 | Google login for an unknown email fails **and creates no user row** | security | P0 |
| API-AUTH-017 | A Google token with `email_verified: false` is rejected | security | P0 |
| API-AUTH-018 | A Google token with the wrong `aud` is rejected | security | P0 |
| API-AUTH-019 | A Google token with the wrong issuer is rejected | security | P0 |
| API-AUTH-020 | An expired Google token is rejected | security | P0 |
| API-AUTH-021 | First Google login stores `google_sub` on the user row | integration | P0 |
| API-AUTH-022 | After the Google account's email changes, `google_sub` still matches the same user | integration | P0 |
| API-AUTH-023 | A password user and a Google login resolve to the same `userId` | integration | P0 |

### Throttling, events, optional config

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-AUTH-024 | Login throttling triggers per email as well as per IP | security | P1 |
| API-AUTH-025 | `user.authenticated` is emitted on every successful login | integration | P1 |
| API-AUTH-026 | The API boots and serves password login with `GOOGLE_CLIENT_ID` unset | integration | P1 |

## Notes
- API-AUTH-016 must assert the **row count is unchanged**, not merely that the
  response was an error. The failure this guards against is a helpful upsert.
- API-AUTH-017..020 need a fake Google verifier. Do not call Google in tests;
  inject a signing key and mint tokens locally, so the negative cases are
  actually reachable.
- API-AUTH-005 is inherently flaky as a strict timing assertion. Declare it, but
  implement it as a coarse bound (same order of magnitude over N samples) or
  skip it with a written reason rather than letting it flap.
