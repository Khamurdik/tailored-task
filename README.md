# Data Room

A virtual data room — the due-diligence kind. An owner uploads documents into a
folder tree and grants outsiders scoped, revocable, read-only access to part of
it. NestJS 11 + Prisma 6 + Postgres 18 behind React 19 + Vite 8, in one pnpm
workspace.

| Looking for | Go to |
| --- | --- |
| **Running it on your laptop** | §1 below — five commands, and no account to create anywhere |
| **Who to sign in as** | §2 below |
| **What needs credentials that are not in this repo** | §3 below |
| The live deployment and a five-minute walkthrough | [`REVIEW.md`](REVIEW.md) |
| The system as a whole | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| What was built, and an honest list of what is missing | [`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) |

---

## 1. Run it locally

### Prerequisites

| | Version | Note |
| --- | --- | --- |
| Node | **26.7.0** | `.nvmrc` pins it. `>=24.15.0` also works — that is the `engines` floor |
| pnpm | **11.x** | `packageManager` pins 11.22.0, and pnpm 10+ self-switches to it |
| Docker | any recent | Runs Postgres and the bucket. Nothing else needs it |

Corepack was unbundled from Node 25+, so on 26 pnpm is installed with npm. Under
nvm, global packages are per-Node-version — install it while 26 is active.

```bash
nvm install 26.7.0 && nvm use 26.7.0
npm i -g pnpm
```

### The five steps

```bash
pnpm install                                      # 1. dependencies (also runs prisma generate)
pnpm --filter @dataroom/shared build              # 2. both apps import this package from dist/

cp apps/api/.env.example apps/api/.env            # 3. configuration — one edit, below
cp apps/web/.env.example apps/web/.env.local

docker compose -f docker-compose.test.yml up -d   # 4. Postgres on :5433, MinIO on :9000
pnpm db:migrate && pnpm db:seed                   #    schema, then accounts and the demo room

pnpm dev                                          # 5. api on :3000, web on :5173
```

Then open **http://localhost:5173** and sign in as one of the accounts in §2.

### The one edit

The two JWT placeholders in `.env.example` are deliberately under the
16-character minimum, so a freshly copied file **refuses to boot** and names them
rather than starting up with `replace-me` signing your tokens. Generate real
ones:

```bash
sed -i "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=\"$(openssl rand -base64 32)\"|; \
        s|^JWT_REFRESH_SECRET=.*|JWT_REFRESH_SECRET=\"$(openssl rand -base64 32)\"|" \
       apps/api/.env
```

macOS `sed` wants `-i ''` rather than `-i`. Or open the file and paste two
different values from `openssl rand -base64 32`.

**Nothing else in either example file needs changing.** Both ship configured for
the local stack: the database URL matches the compose file, the S3 block points
at the MinIO container using that container's own credentials, Google sign-in is
off, and uploads are `pdf-only`.

### Three things that are easy to get wrong

- **Postgres is on `5433`, not 5432.** The compose file avoids the default on
  purpose: a clash with a Postgres you already run surfaces as authentication
  errors against somebody else's database rather than as a failure to start.
- **`pnpm --filter @dataroom/shared build` is neither optional nor automatic.**
  Both apps resolve that package through `dist/`, and a missing one shows up as a
  module-resolution error in whichever app you happened to start.
- **`pnpm db:migrate` does not always seed.** It seeds when it creates or resets
  the database, and skips it when it is only applying a migration to an existing
  one. `pnpm db:seed` is idempotent, so running it every time costs nothing.

### Checking it came up

```bash
curl -s localhost:3000/health
# {"status":"ok"}

curl -s localhost:3000/shares/resolve -H 'x-share-token: VBHV2KVG5Y9F5WZ9'
# {"rootNodeId":"a8ca712c-…","role":"viewer","expiresAt":null}   ← the public link
```

Every command in this section was run start to finish on 2026-08-19, from a
copied `.env.example` with nothing in it but the two generated secrets —
including an upload through MinIO and the download back out of it.

---

## 2. Accounts you can use locally

`pnpm db:seed` provisions six accounts from `SEED_USERS` in `apps/api/.env`,
together with the demo tree they hang off. **There is no sign-up:** the seeder is
the only thing in this system that creates a user.

**Every account uses the same password — `review-2026-meridian`.** It is a demo
credential on `example.com` addresses, which RFC 2606 reserves and which receive
no mail; this system sends no email at all. Change it in `SEED_USERS` and re-seed
with `SEED_FORCE_RESET=true` if you would rather it were something else.

| Sign in as | Who they are | What they demonstrate |
| --- | --- | --- |
| `ana.ruiz@example.com` | Owner of **Project Meridian** | The whole room — upload, share, revoke. Cannot see Bo's room at all |
| `bo.lindqvist@example.com` | Owner of **Project Northwind** | A second, unrelated room: owners are isolated from each other |
| `cara.mensah@example.com` | Invited to **Financials** only | One folder of somebody else's room, and nothing above or beside it |
| `dmytro.kovalenko@example.com` | Invited to **Legal** only | A different slice of the *same* room — two grants that never overlap |
| `erik.sandberg@example.com` | Signed in, granted nothing | Authentication is not authorization |
| `admin@example.com` | Administrator | The only account that reaches `/jobs`. Non-admins get 404 there, not 403 |

And **no account at all**: open http://localhost:5173/s/VBHV2KVG5Y9F5WZ9 in a
private window. The short code is fixed by the seed fixture, so it is the same on
every machine.

> The deployed instance in [`REVIEW.md`](REVIEW.md) has `khamurdik@gmail.com` as
> its administrator instead of `admin@example.com`. That is the only difference
> between the two casts.

The tree those accounts sit in:

```
Project Meridian            (Ana)
├── Financials              → shared with Cara
│   ├── q4-report.pdf
│   └── cap-table.pdf
├── Legal                   → shared with Dmytro
│   └── master-agreement.pdf
├── HR                      → shared with nobody
│   └── headcount.pdf
└── Teaser                  → public link, /s/VBHV2KVG5Y9F5WZ9
    └── teaser.pdf

Project Northwind           (Bo)
└── Diligence
    └── northwind-summary.pdf
```

Two empty screens that are not bugs, worth knowing before you judge them:

- **Cara and Dmytro land on an empty room list.** `GET /nodes` returns only rooms
  you *own*, and they own none — there is no "shared with me" view in this build,
  so an invited user reaches their folder by direct link. Cara's is
  http://localhost:5173/nodes/d681640f-9005-4fb9-864d-0a307a23e266; the node ids
  are fixed by the seed fixture too. Then try Dmytro's folder,
  `52da7215-5e2c-4449-849c-3bb5813fda51`, while still signed in as Cara — the
  same "not available" screen an invented id gives.
- **Erik's list is empty for the opposite reason:** he has access to nothing at
  all. The two look identical from the outside, which is itself a product gap.

**Seeded PDFs have no bytes behind them.** The seeder creates the file rows —
real names, real sizes, the whole permission matrix — but writes nothing to the
bucket, so opening one gets a presigned URL that 404s. Upload a PDF as Ana to
exercise the real path: it goes from the browser straight to MinIO, and the API
never touches the bytes.

---

## 3. What needs credentials, and what happens without them

**No credential of mine is in this repository.** `.env` and `.env.local` are
gitignored and only the `.example` files are tracked. What those contain is
either a placeholder that refuses to boot — the two JWT secrets — or the MinIO
container's own username and password, which sit in plain sight in
`docker-compose.test.yml` and open nothing outside `localhost`.

So a checkout runs the whole product without asking me, AWS, or Google for
anything:

| | Locally | What it would take |
| --- | --- | --- |
| Password sign-in, sessions, token refresh | **works** | — |
| Browse, create, rename, move, delete, breadcrumbs | **works** | — |
| Upload — multiple files, drag-and-drop, per-file progress | **works**, MinIO is the bucket | — |
| PDF preview and download | **works** for files you uploaded | — |
| Public links, per-user grants, revoke, cascade | **works** | — |
| Admin `/jobs`: six scheduled jobs, each triggerable by hand | **works** as `admin@example.com` | — |
| **Google sign-in** | **absent** — the button is not rendered at all, and password login is unaffected | Your own Google OAuth **web client id** in `GOOGLE_CLIENT_ID` (api) and `VITE_GOOGLE_CLIENT_ID` (web). Both are public identifiers rather than secrets; mine are simply not in the repo |
| **Opening a *seeded* PDF** | **404** | Nothing — upload your own file. See the end of §2 |
| **Uploads surviving `docker compose down`** | **lost** | Nothing — MinIO's bucket is tmpfs on purpose, so a restart is a clean bucket |
| **Deploying your own copy** | — | Your own AWS account (RDS, App Runner, S3) and Vercel project. The runbook is [`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) |
| **Changing the deployment linked from [`REVIEW.md`](REVIEW.md)** | — | Not possible; that one is mine. It is there to be clicked, not redeployed |

Google sign-in being optional is a design decision rather than an omission: it
*links* to an already-seeded account by verified email and never creates one, so
a checkout without Google credentials loses nothing but the button. Set both
variables and it appears; leave either blank and it does not.

### The front end with no backend at all

The web app runs with no API, no database and no bucket, answering every request
from fixtures held in memory. The swap happens at the axios *adapter*, so
interceptors, the 401-refresh path, schema parsing and react-query all still run
for real:

```bash
sed -i 's/^VITE_API_MODE=live/VITE_API_MODE=mock/' apps/web/.env.local
pnpm dev:web        # http://localhost:5173
```

Sign in as `ana@example.com` / `change-me-now` or `bo@example.com` /
`change-me-too` — fixture accounts, separate from the seeded ones above, whose
passwords live in a committed file. A production build forces this mode off.
Details in [`DEPLOYMENT.md`](DEPLOYMENT.md) §3.

### Everything else about running it

[`DEPLOYMENT.md`](DEPLOYMENT.md) is the full local reference: every environment
variable that needs a decision, provisioning users by hand, verifying a seed, and
the constraints that bite — one API instance, unrevocable presigned GETs, tokens
in `localStorage`.

---

## The module skeleton

Every directory holds a `TODO.md` that defines what that module owns, what it may
depend on, and what "done" means for it. Those files were written before the code
and are kept current with it: ticked boxes are what exists, and each carries an
**Implementation notes** section recording what did not survive contact.

**All twelve backend modules and all seven frontend features are built.** What
remains is depth rather than shape — see
[`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) §7.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it is the only
document that describes the system as a whole. Everything else is scoped to a
single module on purpose.

Picking this up cold? Start with
[`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) — what was built, the
decisions taken while building it, and an honest list of what is still missing.
Then [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) for where the code
is and [`IMPLEMENTATION-LOG.md`](IMPLEMENTATION-LOG.md) for the blockers hit on
the way. [`HANDOFF.md`](HANDOFF.md) carries the original design decisions and the
version research; [`DEPLOYMENT.md`](DEPLOYMENT.md) is how to run it locally and
[`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) is how it is hosted on AWS and Vercel.

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
| L3 | [`tree`](apps/api/src/tree/TODO.md) | The tree's HTTP surface. `/nodes/*` behind `@RequireAccess`. Owns no state. |
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
test *requirements*; [`tests/`](tests/TODO.md) turns those into **570** addressable,
traceable declarations, grouped by what the user is trying to do, and is where
they are implemented. 394 are implemented, including 81 of the 92 `P0`s. A red
`pnpm test` is still the resting state — the failures are the coverage gate
emitting one per unimplemented declaration. See [`tests/TODO.md`](tests/TODO.md) §4.

## Suggested order

```
packages/shared → tests/registry + gate → tests/contract
       → common → storage → users → nodes → auth → access
       → tree → sharing → links → files
       → web/shared → web/auth → web/explorer → web/uploads
       → web/sharing → web/viewer → web/public-view
       → jobs
```

Five things about this order are load-bearing and were got wrong in an earlier
revision of it:

- **`tree` comes before `sharing`.** An earlier revision put the tree's
  controller after both L3 sharing modules, on the grounds that they would give
  `NodeAccessGuard` its first routes. They cannot give it a *readable* one:
  every route in `sharing` is `@RequireAccess('own')`, which a share token can
  never satisfy, so `API-SHARING-002` — "a token for folder B requesting sibling
  C returns 404", the test a reviewer tries by hand — has nothing to point at
  until `GET /nodes/:id` exists.

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

The [`nodes`](apps/api/src/nodes/TODO.md) **physical schema** was decided when
that module was built: a **materialized path** of ancestor ids, with six indexes
and seven CHECK constraints. The point of publishing a contract first — a `Node`
shape and an ancestor chain as a list of ids — was that **nothing above L1 changed
when the strategy was chosen**, and `path` appears in exactly two files. See
[`nodes/TODO.md`](apps/api/src/nodes/TODO.md) §Storage for the comparison against
a recursive CTE and a closure table.

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
