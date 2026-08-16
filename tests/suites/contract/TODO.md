# contract — the wire format

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../TODO.md).

**Traces** [`packages/shared/TODO.md`](../../../packages/shared/TODO.md)

Pure zod. No app, no database, no network. These run in milliseconds and are the
first thing to go green, because everything else asserts against them.

The point is not "does zod work" — it is that a schema change is caught here
rather than three layers away as a confusing runtime shape mismatch.

## Declared tests

### Shape and inference

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| CONTRACT-001 | Every exported DTO type is inferred from a schema, never hand-written | unit | P1 |
| CONTRACT-002 | A response missing a required field fails to parse | unit | P1 |
| CONTRACT-003 | A response with an unknown extra field is rejected, not silently passed through | unit | P1 |
| CONTRACT-004 | `ErrorCode` union covers every code the API is specified to emit | unit | P0 |

### Request validation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| CONTRACT-005 | Login request rejects a malformed email before it reaches the API | unit | P1 |
| CONTRACT-006 | No register schema is exported | security | P0 |
| CONTRACT-007 | Name fields reject strings over `MAX_NAME_LENGTH` | unit | P1 |
| CONTRACT-008 | Upload init rejects a size over `MAX_FILE_SIZE` | unit | P1 |

### Cross-cutting guarantees

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| CONTRACT-009 | Cursor fields are opaque strings, never structured objects | unit | P1 |
| CONTRACT-010 | `JobStatus` union matches the six statuses jobs declares | unit | P1 |
| CONTRACT-011 | `nextRunAt` parses as an ISO string and rejects a Luxon object | unit | P1 |
| CONTRACT-012 | No Prisma model type is reachable from this package's exports | unit | P1 |

## Notes
- CONTRACT-001 and CONTRACT-012 are type-level assertions. Use `expectTypeOf`
  rather than a runtime check.
- CONTRACT-003 requires the schemas to be strict. If they are not, this test is
  the reason to make them so — an API that silently accepts extra fields cannot
  detect a client running an old contract.
