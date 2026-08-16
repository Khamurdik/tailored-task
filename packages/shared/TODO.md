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
- Shared constants: `MAX_FILE_SIZE`, `MAX_NAME_LENGTH`, `MAX_DEPTH`, `PAGE_SIZE`

## Depends on
`zod` only. No Nest, no React, no Prisma.

## Responsibilities
- [ ] Node schemas: `NodeSummary`, `NodeDetail`, `Breadcrumb`, `ChildrenPage`
- [ ] Upload schemas: `InitUploadRequest/Response`, `CompleteUploadRequest`
- [ ] Share schemas: `CreateShareRequest`, `ShareSummary`
- [ ] Auth schemas: `LoginRequest` `{ email, password }`,
      `GoogleLoginRequest` `{ idToken }`, `RefreshRequest` `{ refreshToken }`,
      `TokenPair` `{ accessToken, refreshToken }`, `SessionUser`.
      **No register schema** — there is no registration endpoint
- [ ] Error codes:
      ```ts
      'NAME_CONFLICT' | 'GONE' | 'CYCLIC_MOVE' | 'DEPTH_LIMIT'
      | 'FILE_TOO_LARGE' | 'NOT_FOUND' | 'UNAUTHENTICATED' | 'RATE_LIMITED'
      ```
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
