# web/auth

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/auth/TODO.md`](../../../../apps/web/src/features/auth/TODO.md)

Login is the first thing anyone touches and the easiest place to look broken.
Most of these overlap deliberately — a flash of the login screen, a lost deep
link, and a stale tab are three symptoms of the same bootstrap, and all three
are worth pinning separately because they regress independently.

## Declared tests

### Signing in with a password

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-014 | A seeded user signs in and lands in the app | unit | P0 |
| WEB-AUTH-015 | An email typed in a different case still signs in | unit | P0 |
| WEB-AUTH-016 | Leading and trailing whitespace in the email is trimmed before submit | unit | P1 |
| WEB-AUTH-017 | An empty email shows a field error and issues no request | unit | P0 |
| WEB-AUTH-018 | An empty password shows a field error and issues no request | unit | P0 |
| WEB-AUTH-019 | A malformed email is caught client-side before the network | unit | P1 |
| WEB-AUTH-020 | Enter in the password field submits the form | unit | P1 |
| WEB-AUTH-021 | Two rapid Enter presses submit once | unit | P0 |
| WEB-AUTH-022 | The password input is `type=password` and never rendered as text | security | P0 |
| WEB-AUTH-023 | Editing a field clears its previous server error | unit | P2 |
| WEB-AUTH-024 | A wrong password leaves the typed email in place | unit | P2 |
| WEB-AUTH-025 | A wrong password clears the password field | security | P2 |

### Signing in with Google

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-026 | A Google sign-in for a seeded user lands in the app | unit | P0 |
| WEB-AUTH-027 | Closing the Google popup shows no error at all | unit | P1 |
| WEB-AUTH-028 | A Google error response renders the same generic message as a bad password | security | P0 |
| WEB-AUTH-029 | An unknown Google account renders that same message and offers no sign-up path | security | P0 |
| WEB-AUTH-030 | The Google button is disabled while a password submit is in flight | unit | P2 |

### Failure, offline, and server errors

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-031 | A 500 renders a retryable error, not a field validation error | unit | P1 |
| WEB-AUTH-032 | An offline submit renders a distinct "cannot reach the server" message | unit | P1 |
| WEB-AUTH-033 | A rate-limited login renders the wait, not a generic failure | unit | P1 |
| WEB-AUTH-034 | A failed submit re-enables the form | unit | P0 |

### Landing in the right place

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-035 | A deep link visited while logged out returns to that link after sign-in | unit | P0 |
| WEB-AUTH-036 | The return path preserves query parameters and hash | unit | P1 |
| WEB-AUTH-037 | A return path pointing at another origin is ignored — no open redirect | security | P0 |
| WEB-AUTH-038 | An already-signed-in user visiting the login route is redirected into the app | unit | P1 |

### Session restoration and expiry

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-039 | A full page reload keeps the session | unit | P0 |
| WEB-AUTH-040 | An expired access token on first load refreshes silently and renders the app | unit | P0 |
| WEB-AUTH-041 | A failed refresh on first load lands on login with no flash of app content | unit | P0 |
| WEB-AUTH-042 | A refresh token that expires mid-session sends the user to login once, not repeatedly | unit | P0 |
| WEB-AUTH-043 | Tokens cleared in another tab log this tab out | unit | P1 |
| WEB-AUTH-044 | A corrupted token in storage reads as logged out, never as a crash | unit | P0 |
| WEB-AUTH-045 | The browser back button after sign-out shows no cached app content | security | P0 |

### What is deliberately absent

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-001 | The login page renders no register or sign-up link | security | P0 |
| WEB-AUTH-002 | The login page renders no link to an unimplemented flow | unit | P0 |
| WEB-AUTH-010 | The Google button is absent when `VITE_GOOGLE_CLIENT_ID` is unset | unit | P1 |
| WEB-AUTH-011 | The Google button is labelled "Sign in", never "Sign up" | unit | P2 |
| WEB-AUTH-046 | No password-reset affordance is rendered while no reset flow exists | unit | P1 |

### Signing out

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-007 | Logout calls the API before clearing local state | security | P0 |
| WEB-AUTH-008 | Logout clears the query cache | unit | P1 |
| WEB-AUTH-009 | A logout in one tab clears the session in another | unit | P1 |
| WEB-AUTH-047 | Logout while uploads are in flight warns before discarding them | unit | P1 |
| WEB-AUTH-048 | Logout still clears local state when the API call fails | security | P0 |

### Route protection and bootstrap

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-AUTH-003 | A failed password login and a failed Google login render the same message | security | P0 |
| WEB-AUTH-004 | Submit is disabled while the request is in flight | unit | P1 |
| WEB-AUTH-005 | Bootstrap renders nothing until `/me` settles — no flash of the login screen | unit | P0 |
| WEB-AUTH-006 | After login the user lands on the originally requested URL | unit | P1 |
| WEB-AUTH-012 | `ProtectedRoute` redirects an anonymous user away from an owner route | security | P0 |
| WEB-AUTH-013 | `ProtectedRoute` never gates `/s/:token` | security | P0 |
| WEB-AUTH-049 | An admin-only route is hidden from a non-admin rather than shown and rejected | security | P0 |
