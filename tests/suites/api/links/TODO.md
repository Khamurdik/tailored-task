# api/links

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/links/TODO.md`](../../../../apps/api/src/links/TODO.md)

This is the one module whose entire input is attacker-controlled. The
indistinguishability group below is the reason it exists as a separate module,
and API-LINKS-004 is the single test that would catch the whole design failing.

## Declared tests

### One failure, indistinguishable

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-LINKS-001 | An unknown credential resolves to 404 | security | P0 |
| API-LINKS-002 | A revoked share's credential resolves to 404 | security | P0 |
| API-LINKS-003 | An expired share's credential resolves to 404 | security | P0 |
| API-LINKS-004 | Unknown, revoked, expired, and deleted-target return byte-identical status, body, and headers | security | P0 |
| API-LINKS-005 | A malformed credential is rejected with the same response as an unknown one, not a validation error | security | P0 |
| API-LINKS-006 | A credential for a share whose node has a deleted ancestor resolves to 404 | security | P1 |

### Credential format and minting

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-LINKS-007 | A minted short code is 16 Crockford base32 characters | unit | P1 |
| API-LINKS-008 | A minted short code never contains `I`, `L`, `O`, or `U` | unit | P1 |
| API-LINKS-009 | 2000 mints produce 2000 distinct codes | unit | P1 |
| API-LINKS-010 | A short code is not derivable from the share id, node id, or creation time | security | P1 |
| API-LINKS-011 | Codes decode case-insensitively, mapping `I`/`l` to `1` and `O` to `0` | unit | P1 |
| API-LINKS-012 | A share created without `shortLink` has a null `short_code_hash` and its code does not resolve | security | P0 |
| API-LINKS-013 | The stored value is a SHA-256 of the code, never the code | security | P0 |

### Resolution

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-LINKS-014 | A valid token resolves to the share's root node id and role | integration | P0 |
| API-LINKS-015 | The token and the short code for one share return byte-identical bodies | integration | P1 |
| API-LINKS-016 | The response carries no node name, type, or child count | security | P1 |
| API-LINKS-017 | Resolution issues no session, no cookie, and no token pair | security | P0 |
| API-LINKS-018 | A 43-character input is never looked up against the short-code column | unit | P1 |

### Leakage and rate

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-LINKS-019 | No response from this module contains a plaintext token or code | security | P0 |
| API-LINKS-020 | `X-Share-Token` is redacted in the request log for this route | security | P1 |
| API-LINKS-021 | The response sets `Referrer-Policy: no-referrer` and `Cache-Control: no-store` | security | P1 |
| API-LINKS-022 | Repeated resolution attempts from one IP are throttled | security | P1 |
| API-LINKS-023 | A throttled response is indistinguishable from a failed resolution to a caller who has not yet hit the limit | security | P2 |

## Notes
- API-LINKS-004 is the aggregate of 001–003 asserted as one comparison rather
  than three separate expectations, and it is the row that matters. Three tests
  each asserting "404" pass happily while the bodies differ by a single field,
  which is all an oracle needs.
- API-LINKS-005 is the case a `ValidationPipe` breaks by default. A zod schema
  rejecting a 12-character code with `VALIDATION_FAILED` tells an attacker their
  guess had the wrong *shape*, which is a free filter on the search space. This
  route must not validate the credential's format before looking it up.
- API-LINKS-010 is not testable as a property in the usual sense. Assert the
  weak version — that two shares created in the same transaction, for the same
  node, one millisecond apart, produce codes with no shared prefix or suffix and
  no correlation to either id.
- API-LINKS-023 is `P2` because getting it fully right means the throttle
  returns 404 rather than 429, which removes a genuinely useful signal from
  legitimate clients. Declared so the trade is visible, not because it should
  necessarily be taken.
