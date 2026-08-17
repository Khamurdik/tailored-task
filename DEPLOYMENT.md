# Deployment

How to run this system locally and how to put it somewhere. Kept current as
modules land — if a step here is wrong, that is a bug in this file.

**Status: 2026-08-17.** **The API boots, connects, and serves `/health`**, and
**the web app has a placeholder data layer that runs with no backend at all**.
`common`, `storage` and `users` are implemented, the first migration is applied,
and the seed provisions users. Every command in §3 and §4 below has been run;
the hosted sections in §5 are the target and are marked as such. §8 tracks what
is not yet true. `pnpm typecheck` is green across all four packages.

---

## 1. Prerequisites

| | Version | Note |
| --- | --- | --- |
| Node | **26.7.0** | `.nvmrc`. Node 26 is Current, not LTS until 2026-10-28 |
| pnpm | **11.22.0** | `packageManager` field; pnpm 10+ self-switches |
| Postgres | **18** | local via `docker-compose`, hosted via Neon |
| Docker | any recent | only for the local database and the integration tests |

**Corepack does not work.** It was unbundled from Node 25+, so `corepack enable`
is not the install path. Use `npm i -g pnpm` — and note that under nvm, global
packages are per-Node-version, so pnpm has to be installed while 26 is active.

```bash
nvm install 26.7.0 && nvm use 26.7.0
npm i -g pnpm
pnpm install
```

**Do not run `ncu -u` on this repo.** Four versions are held deliberately
(TypeScript 6, Prisma 6, and two others — see [docs/TOOLCHAIN.md](docs/TOOLCHAIN.md));
an upgrade sweep silently undoes all four.

---

## 2. Configuration

Two files, neither committed.

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

`common` validates the API's environment with zod **at boot and crashes on
anything missing**, with every offending variable named at once — not one per
restart. A boot failure here is working as intended; it is the alternative — a
service that starts and fails on the first request — that is the bug.

**A freshly copied `.env` does not boot, and should not.** The two JWT
placeholders are under the 16-character minimum, so the first run stops with:

```
Invalid environment. The API will not start until these are fixed:
  JWT_ACCESS_SECRET: Too small: expected string to have >=16 characters
  JWT_REFRESH_SECRET: Too small: expected string to have >=16 characters
```

Generate them and the rest of the example file validates as shipped —
`pdf-only`, two seed users, Google disabled, CORS on `localhost:5173`. The
error names variables and never echoes values; several of these are secrets and
a boot log is the least private place in a deployment.

### The variables that need a decision

| Variable | Why it needs thought |
| --- | --- |
| `DATABASE_URL` | Hosted Postgres needs `sslmode=require`. Neon's **pooled** endpoint is PgBouncer in transaction mode — see §6 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Two different values. `openssl rand -base64 32` twice |
| `SEED_USERS` | A JSON array. This is the **only** way an account is created — see §4 |
| `GOOGLE_CLIENT_ID` | Optional. Leave blank and the button is not rendered; password login still works |
| `UPLOAD_FILE_POLICY` | `pdf-only` (default) or `all-files`. The default is the restrictive one on purpose |
| `JOBS_SCHEDULER_ENABLED` | Must be true on **exactly one** instance — see §6 |
| `CORS_ORIGINS` | Comma-separated. No cookies means no credentialed CORS |

`MAX_FILE_SIZE` is deliberately **not** an environment variable. It is a
compile-time constant in `packages/shared` because the browser validates against
the same number the API enforces, and an env-only limit is one the client cannot
know.

---

## 3. Local development

```bash
pnpm install
pnpm --filter @dataroom/shared build   # both apps import this; build it first
docker compose -f docker-compose.test.yml up -d   # Postgres 18 on :5433
pnpm db:migrate                        # applies migrations
pnpm db:seed                           # provisions SEED_USERS
pnpm dev                               # api on :3000, web on :5173
```

Two things that are easy to get wrong here:

- **The database is on `5433`, not 5432.** A machine running this project very
  likely already has a Postgres on the default port, and a clash surfaces as
  authentication failures against someone else's database rather than as a
  failure to start. Set `DATABASE_URL` to match:
  `postgresql://postgres:postgres@localhost:5433/dataroom?schema=public`.
- **`db:migrate` does not always seed.** `prisma migrate dev` runs the seed when
  it creates or resets the database, and skips it when it is only applying a new
  migration to an existing one. Run `pnpm db:seed` explicitly; it is idempotent,
  so doing it every time costs nothing.

`pnpm --filter @dataroom/shared build` is not optional and not automatic. The
package emits CJS **and** ESM, and both apps resolve it through `dist/`. A stale
or missing `dist` shows up as a module-resolution error in whichever app you
happened to start.

### Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Both apps, watch mode |
| `pnpm build` | `shared`, then both apps |
| `pnpm typecheck` | All packages. Green — a failure here is real |
| `pnpm lint` | All packages |
| `pnpm test` | The whole suite. **Red is the resting state** — see §7 |
| `pnpm declared` | Registry summary: implemented / declared, by suite |
| `pnpm db:migrate` | `prisma migrate dev` — applies migrations **and seeds** |
| `pnpm db:deploy` | `prisma migrate deploy` — applies migrations, **does not seed** |
| `pnpm db:seed` | The seed alone. Safe to re-run |
| `pnpm db:reset` | Drops and rebuilds. **Never in production** |

### Running the web app with no backend

The front end can be developed, demonstrated and reviewed with **no API, no
database and no bucket running**:

```bash
echo 'VITE_API_MODE=mock' >> apps/web/.env.local
pnpm dev:web
```

Requests are answered from fixtures held in memory. The swap happens at the
**axios adapter**, which is the lowest seam still inside the front end — so the
request interceptor, the 401-refresh path, schema parsing and react-query all
run exactly as they will in production, and only the trip to the network is
replaced. Faking at a higher layer would leave the refresh logic unexercised
until the day the API appears, and that logic is where `web/shared`'s two `P0`
tests live.

What the fixtures give you: two rooms, a nested tree with non-ASCII filenames, a
soft-deleted file, a live share link, a revoked one, an expired one, and a
pending email grant. Mutations persist for the session, so a demo can create a
folder, upload into it, share it and revoke the link. Placeholder PDFs are
generated in the browser, so the viewer works too.

Three properties it keeps deliberately, because a mock that gets them wrong
produces a front end that is confidently incorrect:

- denial is **404, never 403**, and every share failure is byte-identical;
- a share token resolves on its subtree and **nowhere else**;
- size and content type come from the uploaded bytes, never from the client's
  claim.

`import.meta.env.PROD` forces the mock off regardless of the flag, so a stray
`VITE_API_MODE=mock` in a deployed environment cannot serve fixtures to real
users. Details in
[`apps/web/src/shared/mock/TODO.md`](apps/web/src/shared/mock/TODO.md).

---

## 4. Provisioning users — there is no registration

Accounts are created from `SEED_USERS` by the Prisma seed step. Nothing on the
wire creates a user, and Google sign-in *links* to an existing account rather
than creating one.

The seed is **idempotent**: re-running it adds new users, leaves existing ones
alone, and does not rewrite a password unless `SEED_FORCE_RESET=true`.

### Why this cannot be a SQL migration

Two independent reasons, both load-bearing:

1. Prisma migrations are static, checksummed SQL with no access to
   `process.env`. Editing one to inject values breaks its checksum.
2. Postgres cannot compute an argon2id hash. `pgcrypto` offers bcrypt and (PG 18)
   sha-crypt; the argon2 extensions are third-party and Neon will not install
   them.

So the hash is produced in Node, by a seed script that runs inside the migration
workflow.

### Production provisioning is a deliberate, separate step

`prisma db seed` runs as part of `migrate dev` and `migrate reset` — **both are
development commands.** Production runs `prisma migrate deploy`, which does not
seed. Left implicit, that means a freshly deployed environment has no users at
all, and since `is_admin` is only ever set by the seeder, no way to reach
`/jobs` either.

```bash
# AFTER `pnpm db:deploy` has applied migrations, once, deliberately:
DATABASE_URL="<prod url>" \
SEED_USERS='[{"email":"ana@corp.com","password":"…","name":"Ana","admin":true}]' \
SEED_FORCE_RESET=false \
pnpm --filter @dataroom/api db:seed
```

Two failure modes this prevents, both worth naming:

- a deploy that completes successfully and leaves nobody able to log in;
- an operator who reaches for `migrate reset` in production to "run the seed"
  and drops the database.

Keep `SEED_FORCE_RESET=false` in that invocation unless the intent is
specifically a password reset.

### Inserting a user by hand

Supported, with no caveat and nothing extra to do. Pending share grants bind
when that user next logs in, which is the only binding mechanism there is — see
[HANDOFF.md](HANDOFF.md) §3.13 for why the `user.created` "fast path" that used
to be described here does not exist.

### Verifying a seed

```bash
pnpm db:seed          # run it twice; the second run should report "unchanged"
docker exec dataroom-postgres \
  psql -U postgres -d dataroom -tAc "select email, is_admin from users order by email"
```

A second run reporting `created` rather than `unchanged` means the idempotency
check is broken, and a re-seed after a deploy would be silently resetting
passwords.

---

## 5. Hosted deployment — the target

Not yet exercised. Recorded now so the constraints are visible before anything
is provisioned.

| Piece | Target | Why |
| --- | --- | --- |
| Web | Vercel | Static build, no server needed |
| API | AWS App Runner | Container, one instance — see §6 |
| Database | Neon | Postgres 18, scales to zero |
| Blobs | S3 | Presigned direct-to-browser, bucket never public |

### S3 bucket prerequisites

- **Block Public Access ON.** Every read is a presigned GET; nothing is public.
- CORS allowing `PUT, GET, HEAD` from the web origin and `http://localhost:5173`,
  exposing `ETag`.
- IAM scoped to `s3:PutObject, GetObject, DeleteObject, HeadObject` on
  `arn:…:bucket/*` only.
- Lifecycle rule aborting incomplete multipart uploads after 1 day. This is the
  owner of one of the four upload failure states — an object whose `/complete`
  was never called.

### Health checks

`/health` returns `{"status":"ok"}` and **must never touch the database.** App
Runner polls it about every 10 seconds; a query there keeps Neon from scaling to
zero and burns the free-tier compute quota in roughly two weeks. The database
check lives on `/health/deep`, which nothing polls.

### CORS and credentials

The API sets no cookies and the client sends none. CORS is therefore
uncredentialed, `CORS_ORIGINS` is an exact-match list, and the
`SameSite=None` problem a Vercel-plus-App-Runner split would normally create
does not arise.

---

## 6. Constraints that will bite if you do not know them

### The API runs on exactly one instance

`minSize: 1`, `maxSize: 1`. This is not a performance choice, it is a
correctness one: the jobs scheduler assumes it. On boot every `running` job row
is marked `interrupted`, which is only sound because a booting instance can
safely assume any such row is its own corpse. With two instances it would corrupt
the other's live runs.

An advisory lock does not fix this on this stack — `pg_try_advisory_lock` is
session-scoped, Prisma pools connections, and Neon's pooled endpoint is
PgBouncer in transaction mode, where session-level advisory locks do not hold at
all. It would appear to work in dev against a direct connection and silently
stop working in production.

If you must scale out, read [`jobs/TODO.md`](apps/api/src/jobs/TODO.md) §5 first;
the upgrade path (transaction-scoped locks plus a heartbeat) is written down
there.

### A presigned GET cannot be revoked

The 60-second TTL is the entire mitigation. Revoking a share does not kill a URL
already handed out.

### Tokens live in `localStorage`

Deliberate — it removes CSRF entirely and makes non-browser clients trivial. The
cost is that a successful XSS reads both tokens, and the refresh token sits
beside the access token, so what is stolen is seven days rather than one. **The
strict CSP is the mitigation that actually works**; everything else on that list
is damage control after it has failed. Ship the CSP with no `unsafe-inline` and
no `unsafe-eval`.

### Node 26 is Current, not LTS

Until 2026-10-28. If a deploy target only offers LTS images, run 24 there and
relax the `engines.node` floor to `>=24.15.0`. All 68 pinned packages were
checked; none exclude either version.

---

## 7. CI

The suite is **red by design** until the last declaration lands — 548 declared,
and the coverage gate emits one failing test per unimplemented one. So a red
build is the resting state and cannot be the merge signal.

CI runs the projects that need no database and gates on **newly failing**, never
on `green == declared`:

```bash
pnpm --filter @dataroom/tests exec vitest run --project gate --project contract --project api-unit
```

`api-integration` needs Postgres and is opt-in.

---

## 8. Not true yet

Tracked here rather than discovered at deploy time.

- **The web app has a complete data layer but no UI.** `shared/` is done —
  client, token store, cross-tab refresh lock, error mapping, query keys, and
  the placeholder data layer. There are no components, no routes and no
  `index.html` entry, so `pnpm dev:web` serves nothing to look at yet and
  `pnpm build` cannot produce a web bundle. The data layer is exercised by 44
  tests rather than by a browser.
- **The API serves only `/health` and `/health/deep`.** `common`, `storage` and
  `users` are in; `nodes`, `auth`, `access`, `sharing`, `links`, `files` and
  `jobs` are not, so there is no login, no tree, and no upload.
- **Only the `users` table exists.** One migration, `init_users`. The `nodes`
  table is waiting on its storage-strategy decision (see
  [`nodes/TODO.md`](apps/api/src/nodes/TODO.md) §Storage), and `shares`,
  `refresh_tokens` and `job_runs` land with their modules.
- **`tests/src/support/` does not exist**, so the `api-integration` project has
  no `global-setup` and cannot run. The compose file it will use is present and
  working.
- ~~`pnpm typecheck` is red in `apps/web`.~~ **Resolved.** All four packages
  typecheck clean as of the first web source file. `TS18003: No inputs were
  found` is gone, so any typecheck failure from here on is a real one.
- **Nothing has been deployed**, so §5 is a plan and not a runbook. In
  particular no S3 bucket has been created, so `storage` has been exercised
  only through its in-memory adapter and `API-STORAGE-008..010` — the three
  that need a real bucket — have never run.
