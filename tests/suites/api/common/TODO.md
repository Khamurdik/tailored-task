# api/common

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/common/TODO.md`](../../../../apps/api/src/common/TODO.md)

Pure helpers. No I/O anywhere in this suite — if a test here needs a database,
it is in the wrong folder.

## Declared tests

### Conflict-name resolution

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-COMMON-001 | `suggestConflictName('a.pdf', taken)` puts the suffix before the extension | unit | P1 |
| API-COMMON-002 | A name already ending in `(3)` increments rather than nesting | unit | P1 |
| API-COMMON-003 | An extensionless name gets the suffix appended | unit | P1 |
| API-COMMON-004 | A dotfile is treated as a name, not as an extension | unit | P1 |
| API-COMMON-005 | A name at the 255-char cap stays within the cap after suffixing | unit | P1 |

### Normalisation and sanitisation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-COMMON-006 | `normalizeName` maps NFD and NFC forms of one string to one value | unit | P0 |
| API-COMMON-007 | `normalizeName` collapses runs of whitespace and trims | unit | P1 |
| API-COMMON-008 | `sanitizeName` strips `../`, null bytes, and path separators | security | P1 |
| API-COMMON-009 | `sanitizeName` strips bidi-override chars U+202A–U+202E | security | P1 |

### Cursors

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-COMMON-010 | A cursor round-trips to the same `(type, name, id)` tuple | unit | P1 |
| API-COMMON-011 | A tampered cursor is rejected rather than decoded to garbage | security | P0 |
| API-COMMON-018 | An emitted cursor satisfies `CursorSchema`, including for a name at the 255-char cap | unit | P0 |

### Configuration and boot

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-COMMON-012 | Boot fails with a readable message when a required env var is missing | integration | P1 |
| API-COMMON-013 | Boot fails when `SEED_USERS` is malformed JSON | integration | P1 |

### Health and error mapping

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-COMMON-014 | `/health` returns `{status:'ok'}` and issues **no** database query | integration | P0 |
| API-COMMON-015 | A P2002 violation surfaces as 409 `NAME_CONFLICT` carrying `suggestedName` | integration | P1 |
| API-COMMON-016 | A P2025 surfaces as 404 `NOT_FOUND` | integration | P1 |
| API-COMMON-017 | No error response body contains a raw Postgres string | security | P1 |

## Notes
- API-COMMON-018 was added after the fact, which is the interesting part. The
  encoder emitted `base64url(payload).base64url(hmac)` and `CursorSchema` is
  `z.base64url()` — a `.` is not in that alphabet, so **every cursor this system
  produced was invalid under its own published contract**, and a client parsing
  the response would have rejected the page it had just been handed. Nothing
  caught it because nothing had ever produced a cursor: `API-COMMON-010`
  round-trips the encoder against the decoder, and two functions that agree with
  each other can both disagree with the schema. The declaration is `P0` because
  the failure is silent at the layer that would notice — pagination simply stops
  working on page two. It also pins the length bound, which was 512 and needed
  to be ~1500 for a Cyrillic name at the cap.
- API-COMMON-014 is worth an explicit query spy, not an eyeball. The reason the
  rule exists (Neon never scales to zero, free tier burns out in ~2 weeks) is
  invisible in any local test, so only the assertion protects it.
- API-COMMON-001..005 are one table-driven test file, but stay five declarations
  — each is a separate behaviour and each can regress alone.
