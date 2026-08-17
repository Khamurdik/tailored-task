# common — L0

## Purpose
Infrastructure shared by every module: configuration, database client, error
shape, pagination, and string handling. Contains no domain concepts.

## Owns
- The validated config object
- The Prisma client instance
- The wire format of every error response

## Public surface
- `AppConfig` (zod-validated, typed)
- `PrismaService`
- `AppError`, `ErrorCode`, `PrismaExceptionFilter`
- `encodeCursor` / `decodeCursor`
- `normalizeName`, `sanitizeName`, `suggestConflictName`
- The event emitter and the typed event map (see below)
- Constants: re-exported from `packages/shared`, which **owns** them. This
  module declares none of its own

## Depends on
`zod`, and `packages/shared` for the `ErrorCode` union and the constants.
Nothing else.

## Must not depend on
Any domain module — `nodes`, `users`, `auth`, `access`, and everything above
them. If a helper needs a domain type, it belongs in that domain module.

> This used to read "Depends on: Nothing / Must not depend on: Anything", which
> was never true — the config schema is zod and the error envelope needs
> `ErrorCode`. The intent was always "no domain modules"; it now says that.

## Events

This module owns the bus, because every other candidate is a domain module and
would drag its concerns into the layer below it.

- [x] A typed emitter. **Built on a plain `Map`, not `@nestjs/event-emitter`** —
      that package is not installed, and adding a dependency for a bus whose
      survival is still an open question is paying up front for a subsystem
      that may be deleted. What it buys over 40 lines is `@OnEvent()`
      decorators, wildcards, and namespacing; two events need none of them.
      Nothing outside `EventBus` knows what it is built on, so swapping the
      internals later touches one file
- [x] The payload contract lives in `packages/shared` so both sides of every
      listener compile against one definition:
      ```ts
      'user.authenticated' { userId, email }
      'node.deleted'       { rootId, nodeIds }
      ```
- [x] Emitters and listeners, so the wiring is greppable in one place:
      `user.authenticated` — `auth` → `sharing` · `node.deleted` — `nodes` →
      `sharing`
- [x] Listener failures are logged and swallowed. An event handler must never
      fail the request that emitted it
- [ ] ~~`user.created` — seeder → `sharing`~~ **Removed, not deferred.** The
      seeder is a separate process (`prisma db seed` spawns
      `node prisma/seed.ts`); the bus and its listener are inside the API. An
      in-process emitter cannot cross that, so the fast path could never have
      fired — and the other provisioning route, a hand-written `INSERT`, emits
      nothing either. The event had no reachable emitter. Login-time claiming
      in `sharing` is not the guarantee behind the mechanism, it *is* the
      mechanism. See HANDOFF.md §3.13

## Responsibilities
- [x] Zod config schema; **crash at boot** on a missing var with a readable message
  - [x] `SEED_USERS` parses as a JSON array of `{ email, password, name }` and
        is validated by the same schema the seeder uses
  - [x] `GOOGLE_CLIENT_ID` is optional — a checkout without Google credentials
        must still boot and serve password login
  - [x] `UPLOAD_FILE_POLICY` is `'pdf-only' | 'all-files'`, **defaulting to
        `pdf-only`**, so an unconfigured deployment is the restrictive one
  - [x] No cookie secret and no CSRF secret. This API sets no cookies
- [x] `PrismaService` with `onModuleInit` connect and graceful shutdown hook
- [x] Global exception filter mapping `P2002 → 409 NAME_CONFLICT` (carrying
      `suggestedName`) and `P2025 → 404 NOT_FOUND`
- [x] Error envelope `{ code, message, details? }` — codes live in
      `packages/shared` so the client can switch on them
- [x] Opaque base64url keyset cursor over `(type, name, id)`
- [x] `normalizeName`: NFC normalize, trim, collapse whitespace
- [x] `sanitizeName`: strip `../`, null bytes, path separators, Unicode
      bidi-override chars (`U+202A`–`U+202E`), cap at 255
- [x] `suggestConflictName('a.pdf', taken) → 'a (1).pdf'` — suffix goes before
      the extension, and an existing `(n)` increments rather than nesting
- [x] Health module: `/health` returns `{ status: 'ok' }` with **no I/O**

## Invariants
- `/health` must never touch the database. App Runner polls it every ~10s; a
  DB query there prevents Neon from scaling to zero and burns the free-tier
  compute quota in about two weeks. Put the DB check on `/health/deep`.
- Every error leaving the API has a `code` from the shared union. No raw
  Postgres strings reach a client.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/common/TODO.md`](../../../../tests/suites/api/common/TODO.md) and implemented there — never in this module's folder.
- [ ] `suggestConflictName` table test, including extensionless names, dotfiles,
      names already ending in `(3)`, and names at the 255-char cap
- [ ] `normalizeName` maps NFD and NFC forms of the same string to one value
- [ ] Cursor round-trips and rejects tampered input

## Done when
Boot fails loudly on bad config, and a forced unique-constraint violation
returns a clean 409 with a usable suggested name.
