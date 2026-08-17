# api/sharing

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/sharing/TODO.md`](../../../../apps/api/src/sharing/TODO.md)

The scoping test here is the one a reviewer will try by hand.

## Declared tests

### Links, scoping, and revocation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SHARING-001 | Create a public link, open it anonymously, revoke it, and the same token 404s | integration | P0 |
| API-SHARING-002 | **Scoping**: a token for folder B requesting sibling folder C returns 404 — not 403, not 200 | security | P0 |
| API-SHARING-003 | A token for folder B cannot read B's parent | security | P0 |
| API-SHARING-004 | The plaintext token appears in exactly one response and never again | security | P1 |
| API-SHARING-005 | The stored value is a SHA-256 of the token, not the token | security | P0 |
| API-SHARING-006 | The plaintext token never appears in a log line | security | P1 |
| API-SHARING-007 | Only an owner may create a share; a viewer gets 404 | security | P1 |
| API-SHARING-008 | Revoking is effective immediately for an in-flight session | integration | P1 |
| API-SHARING-009 | Cascade-deleting a parent revokes grants on every descendant | integration | P0 |

### Pending grants and binding

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SHARING-010 | A grant for an email with no user row stays pending | integration | P1 |
| API-SHARING-011 | RETIRED — binding via a `user.created` event. The seeder is a separate process from the API, so an in-process event could never reach the listener; login is the only trigger. Kept so the number is never reused. See HANDOFF.md §3.13 | integration | P1 |
| API-SHARING-012 | Inserting that user with raw SQL then logging in binds the grant, with no event involved | integration | P0 |
| API-SHARING-013 | Claiming is idempotent — logging in twice binds the grant once and does not duplicate it | unit | P1 |

### Listing, moves, and expiry

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SHARING-014 | The grant list distinguishes direct grants from inherited ones and names the ancestor | integration | P1 |
| API-SHARING-015 | Moving a node into a shared folder grants inherited access | integration | P1 |
| API-SHARING-016 | Moving a node out of a shared folder removes inherited access | integration | P1 |
| API-SHARING-017 | A direct grant on a node survives a move | integration | P1 |
| API-SHARING-018 | A share token is 32 CSPRNG bytes and two links never collide | security | P1 |
| API-SHARING-019 | An expired share resolves to 404 | integration | P1 |

## Notes
- API-SHARING-015..017 are the move-semantics decision from the module TODO.
  They are declared as tests because the behaviour is surprising either way, and
  a test is the only durable record of which surprise was chosen.
- API-SHARING-012 is the one that would not exist if the design had kept a
  registration endpoint. It exists because operators insert users by hand.
- API-SHARING-011 is retired rather than deleted, per the format rules. It
  declared the `user.created` fast path, which was removed when it turned out
  the seeder runs in its own process and the bus is in the API's — see
  HANDOFF.md §3.13. API-SHARING-012 already covers the surviving mechanism, and
  013 was reworded from "both paths agree" to idempotency, since there is now
  one path that runs on every login rather than two that could drift.
