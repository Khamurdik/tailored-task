# Data Room — module skeleton

This tree contains no code yet. Every directory holds a `TODO.md` that defines
what that module owns, what it may depend on, and what "done" means for it.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it is the only
document that describes the system as a whole. Everything else is scoped to a
single module on purpose.

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
| L1 | [`nodes`](apps/api/src/nodes/TODO.md) | The tree. Rooms, folders, files as one table. Paths, naming, moves, stats. |
| L2 | [`auth`](apps/api/src/auth/TODO.md) | Password + Google login, bearer tokens, session guards. Identity only — never authorization. |
| L2 | [`access`](apps/api/src/access/TODO.md) | Grants storage + permission resolution + route guards. |
| L3 | [`sharing`](apps/api/src/sharing/TODO.md) | Share use-cases: issue links, invite users, revoke, cascade. |
| L3 | [`files`](apps/api/src/files/TODO.md) | Upload lifecycle orchestration. Binds `nodes` to `storage`. |
| L3 | [`search`](apps/api/src/search/TODO.md) | Name search scoped to a room. *Optional / extra credit.* |
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
| [`features/public-view`](apps/web/src/features/public-view/TODO.md) | Read-only shell for `/s/:token`. Reuses explorer components. |

### Shared

| Module | One-line responsibility |
| --- | --- |
| [`packages/shared`](packages/shared/TODO.md) | Zod schemas, inferred DTO types, error codes. The API contract. |

## Suggested order

```
common → storage → users → nodes → auth → access → sharing → files
       → web/shared → web/auth → web/explorer → web/uploads
       → web/sharing → web/public-view → web/viewer
       → jobs → search
```

`search` is extra credit. `audit` is **deferred and out of scope** — third
priority, behind `jobs` and `search`. Cut `search` before cutting anything in
the core path.

## Authentication at a glance

- **No registration.** Users are provisioned from `.env` by the Prisma seed
  step, which runs as part of `db:migrate`.
- **Email and password is primary**, hashed with argon2id.
- **Google login is secondary** and links to an existing account. It never
  creates one.
- **No cookies.** Bearer tokens in `localStorage`, refresh token in the request
  body — so CSRF cannot occur and mobile clients need no cookie jar. The
  trade-off (XSS can read the token) and its mitigations are written down in
  [`apps/api/src/auth/TODO.md`](apps/api/src/auth/TODO.md).
