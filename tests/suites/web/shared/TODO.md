# web/shared

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/shared/TODO.md`](../../../../apps/web/src/shared/TODO.md)

Every user interaction goes through this client, so a bug here looks like a bug
in seven features at once.

## Declared tests

### Credentials on the wire

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARED-001 | The request interceptor attaches `Authorization: Bearer` from the token store | unit | P1 |
| WEB-SHARED-002 | The client sends no cookies (`withCredentials: false`) | security | P1 |
| WEB-SHARED-006 | The refresh token is sent in the body and never in a URL | security | P0 |
| WEB-SHARED-007 | `X-Share-Token` is attached automatically on share routes only | security | P1 |
| WEB-SHARED-013 | An owner request never carries a share token | security | P1 |
| WEB-SHARED-014 | A share request never carries the owner's bearer token | security | P1 |
| WEB-SHARED-008 | `localStorage` is touched in exactly one module | security | P1 |

### Refreshing a session

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARED-003 | A 401 triggers one refresh and one retry of the original request | unit | P1 |
| WEB-SHARED-004 | Ten simultaneous 401s trigger exactly one refresh call and all ten succeed | unit | P0 |
| WEB-SHARED-005 | A failed refresh clears the store once and redirects, without looping | unit | P1 |
| WEB-SHARED-015 | A request that 401s twice is not retried a third time | unit | P1 |
| WEB-SHARED-016 | The retried request carries the new token, not the old one | unit | P1 |
| WEB-SHARED-017 | A 401 on the refresh endpoint itself does not recurse | unit | P1 |
| WEB-SHARED-018 | A non-401 error is never retried by the refresh path | unit | P1 |
| WEB-SHARED-028 | Two contexts hitting 401 together produce one refresh between them, and neither is logged out | security | P0 |
| WEB-SHARED-029 | A waiter that acquires the refresh lock second re-reads the rotated pair instead of refreshing again | security | P1 |

### Turning failures into something a user can act on

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARED-010 | The error envelope unwraps into a typed `AppError` with its code | unit | P1 |
| WEB-SHARED-019 | Every `ErrorCode` maps to a message and a recovery action | unit | P1 |
| WEB-SHARED-020 | An unrecognised code falls back to a generic message rather than rendering the code | unit | P1 |
| WEB-SHARED-021 | A network failure is distinguishable from a server error in the UI | unit | P1 |
| WEB-SHARED-022 | A timeout surfaces as retryable | unit | P1 |
| WEB-SHARED-023 | A 500 body that is not the error envelope still produces an `AppError` | unit | P1 |
| WEB-SHARED-024 | No user-facing message contains a stack trace or a raw server string | security | P1 |

### Caching and freshness

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-SHARED-011 | 404 and 410 are not retried | unit | P1 |
| WEB-SHARED-012 | Every mutation invalidates the `['nodes']` prefix | unit | P1 |
| WEB-SHARED-025 | Refocusing the window refetches active queries | unit | P1 |
| WEB-SHARED-026 | Logging out empties the cache so the next user sees nothing stale | security | P1 |
| WEB-SHARED-009 | A malformed stored token reads as logged-out, not as an error | unit | P1 |
| WEB-SHARED-027 | A response failing schema validation is surfaced as an error, not rendered | security | P1 |
