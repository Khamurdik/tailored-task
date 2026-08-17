# api/files

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/files/TODO.md`](../../../../apps/api/src/files/TODO.md)

The module specifies four states and says only one is the happy path. This suite
has a test for each of the other three.

## Declared tests

### Init and validation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-001 | Init reserves the name by inserting a `pending` node immediately | integration | P1 |
| API-FILES-002 | Ten concurrent inits for one name yield ten distinct names | integration | P1 |
| API-FILES-003 | `/complete` without an upload returns 400 and leaves the node `pending` | integration | P1 |
| API-FILES-004 | `size_bytes` comes from `HeadObject`, not from the client's claim | security | P0 |
| API-FILES-005 | `content_type` comes from S3, not from the client | security | P1 |
| API-FILES-006 | Under `pdf-only`, non-PDF bytes declared as `application/pdf` are rejected on magic-byte check | security | P0 |
| API-FILES-007 | A size over `MAX_FILE_SIZE` is rejected at init | integration | P1 |
| API-FILES-018 | Under `all-files`, the same non-PDF upload is accepted | integration | P1 |
| API-FILES-019 | The policy is read from config — neither value is compiled in | unit | P1 |
| API-FILES-020 | A rejected type leaves the node `pending` and returns 415 `UNSUPPORTED_FILE_TYPE` | integration | P0 |

### Reaping orphans

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-008 | State "node pending, no object" is cleared by the reaper after 1h | integration | P1 |
| API-FILES-009 | The reaper leaves a pending node younger than 1h alone | integration | P1 |
| API-FILES-010 | Reaping a pending node frees its name for reuse | integration | P1 |
| API-FILES-011 | `reapPending` returns `{scanned, deleted}` | unit | P1 |

### Lifecycle and permissions

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-012 | Soft-deleting a node does not delete the S3 object | integration | P1 |
| API-FILES-013 | `/nodes/:id/content-url` is permission-checked and 404s for a stranger | security | P0 |
| API-FILES-014 | The issued content URL expires in 60 seconds | integration | P1 |
| API-FILES-015 | `/abort` cleans up on user cancel and frees the name | integration | P1 |
| API-FILES-016 | Completing an upload bumps ancestor rollup counters | integration | P1 |
| API-FILES-017 | Twenty concurrent uploads all land with conflicts resolved and no orphans in either direction | integration | P1 |
| API-FILES-021 | A `pending` file has no content URL — 404, not a distinguishable error | security | P1 |
| API-FILES-022 | No value of `UPLOAD_FILE_POLICY` can cause non-PDF bytes to be served `inline` | security | P0 |

## Notes
- API-FILES-004 and API-FILES-005 are declared separately from the happy path
  because the failure they guard is silent: a lying client produces a plausible
  row, and nothing looks wrong until a quota or a download breaks.
- API-FILES-017 is the module's own "done when". Keep it as one test; it is slow
  and it is worth it. It also found the one real defect in this module: with
  twenty simultaneous uploads of a single name, every writer computed the *same*
  lowest free suffix, collided in lockstep, and exhausted the ten-attempt retry
  cap — so a user got a 409 on an upload that should simply have been renamed.
  `nodes/TODO.md` specifies the cap of ten and this module's acceptance bar is
  twenty concurrent uploads; the two could not both hold with deterministic
  candidates. `NodeNamingService.nextFreeName` now spreads its candidates from
  the third attempt onward.
- API-FILES-022 overlaps `API-STORAGE-011` and `API-STORAGE-012` on purpose, and
  they are not duplicates: those assert what `presignGet` does, and this asserts
  that the *policy toggle* cannot reach it. The rule is stated as an invariant in
  both modules because it is only true while both hold, and the chain that makes
  it matter — S3 origin, `inline`, an `<iframe>`, and a CSP that does not apply
  there — is invisible from either one alone.
