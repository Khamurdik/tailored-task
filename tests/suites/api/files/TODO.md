# api/files

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/files/TODO.md`](../../../../apps/api/src/files/TODO.md)

The module specifies four states and says only one is the happy path. This suite
has a test for each of the other three.

## Declared tests

### Init and validation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-001 | Init reserves the name by inserting a `pending` node immediately | integration | P0 |
| API-FILES-002 | Ten concurrent inits for one name yield ten distinct names | integration | P0 |
| API-FILES-003 | `/complete` without an upload returns 400 and leaves the node `pending` | integration | P0 |
| API-FILES-004 | `size_bytes` comes from `HeadObject`, not from the client's claim | security | P0 |
| API-FILES-005 | `content_type` comes from S3, not from the client | security | P0 |
| API-FILES-006 | Non-PDF bytes declared as `application/pdf` are rejected on magic-byte check | security | P0 |
| API-FILES-007 | A size over `MAX_FILE_SIZE` is rejected at init | integration | P0 |

### Reaping orphans

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-008 | State "node pending, no object" is cleared by the reaper after 1h | integration | P0 |
| API-FILES-009 | The reaper leaves a pending node younger than 1h alone | integration | P0 |
| API-FILES-010 | Reaping a pending node frees its name for reuse | integration | P0 |
| API-FILES-011 | `reapPending` returns `{scanned, deleted}` | unit | P1 |

### Lifecycle and permissions

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-FILES-012 | Soft-deleting a node does not delete the S3 object | integration | P0 |
| API-FILES-013 | `/nodes/:id/content-url` is permission-checked and 404s for a stranger | security | P0 |
| API-FILES-014 | The issued content URL expires in 60 seconds | integration | P0 |
| API-FILES-015 | `/abort` cleans up on user cancel and frees the name | integration | P1 |
| API-FILES-016 | Completing an upload bumps ancestor rollup counters | integration | P1 |
| API-FILES-017 | Twenty concurrent uploads all land with conflicts resolved and no orphans in either direction | integration | P0 |

## Notes
- API-FILES-004 and API-FILES-005 are declared separately from the happy path
  because the failure they guard is silent: a lying client produces a plausible
  row, and nothing looks wrong until a quota or a download breaks.
- API-FILES-017 is the module's own "done when". Keep it as one test; it is slow
  and it is worth it.
