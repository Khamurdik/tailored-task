# Data Room — module skeleton

This tree contains no code yet. Every directory holds a `TODO.md` that defines
what that module owns, what it may depend on, and what "done" means for it.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it is the only
document that describes the system as a whole. Everything else is scoped to a
single module on purpose.

Picking this up cold? [`HANDOFF.md`](HANDOFF.md) carries the decision log, the
version research, and the list of questions still open.

## How to use these files

Each `TODO.md` follows the same shape:

| Section | What it is for |
| --- | --- |
| **Purpose** | One or two sentences. If you cannot write it without "and", the module is doing two things. |
| **Owns** | The tables, files, or client state this module is the sole writer of. Nothing else writes them. |
| **Public surface** | What other modules are allowed to import. Anything not listed here is internal. |
| **Depends on** | Allowed imports, in dependency-layer order. |
| **Must not depend on** | The specific temptations that would create a cycle or leak a concern. |
| **Responsibilities** | Checklist. These become commits. |
| **Invariants** | Rules that must hold after every operation. Most of these become tests. |
| **Tests** | The minimum set worth writing for this module. |
| **Done when** | The acceptance bar. |

Work one module at a time, bottom of the dependency graph upward. Tick the
checklist as you go and leave the file in the repo — it doubles as the design
record the README deliverable asks for.

## Module index

### Backend — `apps/api/src/`

| Layer | Module | One-line responsibility |
| --- | --- | --- |
| L0 | [`common`](apps/api/src/common/TODO.md) | Config, Prisma client, error envelope, pagination, string handling. No domain logic. |
| L1 | [`storage`](apps/api/src/storage/TODO.md) | Blob storage adapter. Presigned URLs, head, delete. Knows nothing about the tree. |
| L1 | [`users`](apps/api/src/users/TODO.md) | User records and lookup. Provisioned from `.env` by the seeder — no signup. |
| L1 | [`nodes`](apps/api/src/nodes/TODO.md) | The tree. Rooms, folders, files as one self-referencing table. Ancestry, naming, moves, stats. |
| L2 | [`auth`](apps/api/src/auth/TODO.md) | Password + Google login, bearer tokens, session guards. Identity only — never authorization. |
| L2 | [`access`](apps/api/src/access/TODO.md) | Grants storage + permission resolution + route guards. |
| L3 | [`sharing`](apps/api/src/sharing/TODO.md) | Share use-cases: issue links, invite users, revoke, cascade. Owner-only, every route. |
| L3 | [`links`](apps/api/src/links/TODO.md) | The anonymous edge: resolve a share token or a 16-char short code to a grant. One uniform failure. |
| L3 | [`files`](apps/api/src/files/TODO.md) | Upload lifecycle orchestration. Binds `nodes` to `storage`. |
| L3 | [`search`](apps/api/src/search/TODO.md) | Name search scoped to a room. **Deferred — do not implement.** |
| L4 | [`audit`](apps/api/src/audit/TODO.md) | Append-only event log. **Deferred — do not implement.** |
| L4 | [`jobs`](apps/api/src/jobs/TODO.md) | Scheduled cleanup as queryable job objects: every run has a status, every job can be triggered by hand. |

### Frontend — `apps/web/src/`

| Module | One-line responsibility |
| --- | --- |
| [`shared`](apps/web/src/shared/TODO.md) | API client, token store, error mapping, query keys, UI primitives. |
| [`features/auth`](apps/web/src/features/auth/TODO.md) | Login (password + Google), session bootstrap, route protection. |
| [`features/explorer`](apps/web/src/features/explorer/TODO.md) | Browse, breadcrumbs, create, rename, move, delete. |
| [`features/uploads`](apps/web/src/features/uploads/TODO.md) | Transfer queue, dropzone, progress panel. Client-side state, not server state. |
| [`features/viewer`](apps/web/src/features/viewer/TODO.md) | PDF preview. |
| [`features/sharing`](apps/web/src/features/sharing/TODO.md) | Share dialog and grant management. |
| [`features/public-view`](apps/web/src/features/public-view/TODO.md) | Read-only shell for `/s/:code`. Reuses explorer components. |

### Shared

| Module | One-line responsibility |
| --- | --- |
| [`packages/shared`](packages/shared/TODO.md) | Zod schemas, inferred DTO types, error codes. The API contract. |

### Tests

| Module | One-line responsibility |
| --- | --- |
| [`tests`](tests/TODO.md) | Every test in the system, declared before it is written. Mirrors the module tree. |

No test lives inside `apps/api` or `apps/web`. Each module `TODO.md` states its
test *requirements*; [`tests/`](tests/TODO.md) turns those into 534 addressable,
traceable declarations, grouped by what the user is trying to do, and is where
they are implemented. The first run is meant to be red — see
[`tests/TODO.md`](tests/TODO.md) §4.

## Suggested order

```
packages/shared → tests/registry + gate → tests/contract
       → common → storage → users → nodes → auth → access
       → sharing → links → files
       → web/shared → web/auth → web/explorer → web/uploads
       → web/sharing → web/viewer → web/public-view
       → jobs
```

Four things about this order are load-bearing and were got wrong in an earlier
revision of it:

- **The contract and the coverage gate come first.** `common` re-exports
  constants `packages/shared` owns, and a gate written after the suites exist
  cannot make run #1 red — which is the whole point of it (`tests/TODO.md` §4).
- **`auth/password.ts` lands with `users`, not with `auth`.** The seeder imports
  it, and the seeder is part of `users`. It is a leaf file in the strip-safe
  zone, not the `auth` module arriving early.
- **`web/viewer` comes before `web/public-view`**, which depends on it. The
  reverse order means building the viewer twice.
- **`storage` is a parallel lane, not a step.** It touches neither the tree nor
  the database, so it only has to exist before `files`.

Two modules are **deferred and out of scope**: [`search`](apps/api/src/search/TODO.md)
(permission-filtered pagination is the hard part, and it is not worth the risk
here) and [`audit`](apps/api/src/audit/TODO.md). Both stay in the repo as design
notes. Neither has a dependent, which is what makes deferring them free.

The [`nodes`](apps/api/src/nodes/TODO.md) **physical schema** is still an open
decision, and it is no longer on the critical path. That module now publishes a
contract — a `Node` shape and an ancestor chain as a list of ids — that every
module above L1 compiles against, so the choice between a materialized path, a
recursive CTE, and a closure table stays inside the repository and can be made
when `nodes` is built. See [`nodes/TODO.md`](apps/api/src/nodes/TODO.md)
§Storage.

## Authentication at a glance

- **No registration.** Users are provisioned from `.env` by the Prisma seed
  step, which runs as part of `db:migrate`. That is a **local** workflow —
  `prisma migrate deploy` does not run seeds, so production provisioning is a
  deliberate one-off `pnpm db:seed`. The runbook is in
  [`users/TODO.md`](apps/api/src/users/TODO.md).
- **Email and password is primary**, hashed with argon2id.
- **Google login is secondary** and links to an existing account. It never
  creates one, and it is optional — leave `VITE_GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_ID` unset and the button is not rendered at all, so a checkout
  without Google credentials still runs on password login.
- **No cookies.** Bearer tokens in `localStorage`, refresh token in the request
  body — so CSRF cannot occur and mobile clients need no cookie jar. The
  trade-off (XSS reads both tokens) and its mitigations are written down in
  [`apps/api/src/auth/TODO.md`](apps/api/src/auth/TODO.md).

### Known limitations, stated rather than hidden

- **Google account linking is first-come-first-served.** The first Google
  identity presenting a verified email that matches a seeded user claims that
  account, and `google_sub` is then stored permanently. There is no confirmation
  step from an already-authenticated session. That is acceptable here because
  every account is provisioned by an operator who controls the email addresses;
  a real deployment should require the link to be confirmed while signed in.
- **A presigned GET cannot be revoked once issued.** The 60-second TTL is the
  entire mitigation. Revoking a share does not kill a URL already handed out.
- **A short share link is weaker than the token it aliases** — 80 bits against
  256 — and a grant is only as strong as its weakest credential. That is why
  short codes are opt-in per share rather than the default, and why 64 bits is
  the floor below which they will not go. See
  [`links/TODO.md`](apps/api/src/links/TODO.md).
- **The scheduler runs on exactly one instance** — see
  [`jobs/TODO.md`](apps/api/src/jobs/TODO.md) §5. Do not scale the API service
  past one instance without reading it first.
- **Share failures are indistinguishable by design.** Invalid, revoked, expired,
  and deleted links all render one screen. The four-screen alternative and the
  sign-off it requires are in
  [`public-view/TODO.md`](apps/web/src/features/public-view/TODO.md).
