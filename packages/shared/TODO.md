# packages/shared

## Purpose
The API contract. Zod schemas, types inferred from them, and the error-code
union. Imported by both apps so a contract change is a compile error on both
sides.

## Owns
The wire format.

## Public surface
- Request/response schemas per endpoint
- Types inferred via `z.infer` — **never hand-written**
- `ErrorCode` union
- Shared constants — **this package is their sole owner**; `common` re-exports
  and declares none of its own:

  | Constant | Value |
  | --- | --- |
  | `MAX_DEPTH` | 32 |
  | `MAX_NAME_LENGTH` | 255 |
  | `MAX_FILE_SIZE` | 52_428_800 (50 MiB) |
  | `PAGE_SIZE` | 50 |

  These are compile-time constants, not config. The client validates against the
  same numbers the server enforces, which is the whole point of the package —
  `MAX_FILE_SIZE` in particular cannot be an env var, because then
  `CONTRACT-008` and `WEB-UPLOADS-020` would be asserting against a value the
  bundle does not have. (`MAX_FILE_SIZE_BYTES` was removed from `.env.example`
  for exactly this reason.) `PAGE_SIZE` replaces the old `PAGE_SIZE_DEFAULT`
  name that `common` used; one constant, one name.

## Depends on
`zod` only. No Nest, no React, no Prisma.

## Responsibilities
- [x] Node schemas: `NodeSummary`, `NodeDetail`, `Breadcrumb`, `ChildrenPage`
- [x] Upload schemas: `InitUploadRequest/Response`, `CompleteUploadRequest`
- [x] Share schemas: `CreateShareRequest` (carries `shortLink?: boolean`,
      default false), `ShareSummary`, `CreatedShare` — the create response, the
      only place a plaintext credential appears, carrying `token` and an
      optional `shortCode`
- [x] Share resolution: `ResolveShareResponse`
      `{ rootNodeId, role, expiresAt: string | null }`. Deliberately does not
      embed a node summary — see [`links/TODO.md`](../../apps/api/src/links/TODO.md).
      There is no `ResolveShareRequest`: the credential travels in the
      `X-Share-Token` header, never in a body or a query string
- [x] Job schemas: `JobSummary` (definition + `lastRun` + `nextRunAt`),
      `JobRunSummary`, `JobRunDetail`, `TriggerJobResponse` `{ runId }`, and the
      `JobStatus` union (`running | succeeded | failed | timed_out | skipped |
      interrupted`). `nextRunAt` is an ISO string on the wire — never a Luxon
      `DateTime`, which is what `cron@4` hands the API internally
- [x] Auth schemas: `LoginRequest` `{ email, password }`,
      `GoogleLoginRequest` `{ idToken }`, `RefreshRequest` `{ refreshToken }`,
      `TokenPair` `{ accessToken, refreshToken }`, `SessionUser`.
      **No register schema** — there is no registration endpoint
- [x] Error codes:
      ```ts
      'NAME_CONFLICT' | 'GONE' | 'CYCLIC_MOVE' | 'DEPTH_LIMIT'
      | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE' | 'NOT_FOUND'
      | 'UNAUTHENTICATED' | 'RATE_LIMITED' | 'CONFLICT' | 'VALIDATION_FAILED'
      ```
      `UNSUPPORTED_FILE_TYPE` is what `/complete` returns under
      `UPLOAD_FILE_POLICY=pdf-only`. `CONFLICT` is what `jobs` returns when a
      run is already in flight and `onOverlap` is `reject`. `VALIDATION_FAILED`
      covers every 400 the `ValidationPipe` raises — without it, `CONTRACT-004`
      ("the union covers every code the API emits") is red against the specs
      One code covers every login failure. Splitting it into
      `BAD_PASSWORD` / `NO_SUCH_USER` would hand the client an email oracle that
      the API is deliberately built to withhold
- [ ] Serve as the API `ValidationPipe` schema and the client parse schema —
      one definition, both ends

## Invariants
- Zero runtime dependencies beyond zod. Anything heavier belongs in an app.
- A Prisma model type never leaks into this package. The database schema and
  the wire format are allowed to diverge.

## Done when
Renaming a response field breaks the build in both apps.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/contract/TODO.md`](../../tests/suites/contract/TODO.md) and implemented there — never in this module's folder.
