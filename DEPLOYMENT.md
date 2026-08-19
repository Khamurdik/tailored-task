# Deployment — locally

How to run this system on a laptop. Kept current as modules land — if a step
here is wrong, that is a bug in this file.

**For AWS and Vercel, see [`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md)**, which
owns the hosted deployment end to end: what is provisioned, the identities and
their policies, the decisions taken while building it, the runbook and teardown.
The two were one document until 2026-08-18 and had grown two audiences.

For *what is built* rather than *how to run it*, see
[`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md).

**Status: 2026-08-17.** **The product works end to end.** Every module in the
layer graph is built; the API serves 28 routes; the web app signs in, browses,
uploads, previews, shares, and serves a read-only page to a stranger at
`/s/:code`. It runs three ways: against the real stack, against a **local S3
bucket** (MinIO in the compose file — no AWS account needed), and against the
placeholder data layer with no backend at all.

Twenty Playwright journeys cover the real browser + API + Postgres + bucket, and
`JOURNEY-001` is the whole product in one pass.

Every command in §3 and §4 below has been run. §8 tracks what is not yet true.
`pnpm typecheck` and `pnpm lint` are green across all four packages.

---

## 1. Prerequisites

| | Version | Note |
| --- | --- | --- |
| Node | **26.7.0** for development; **`>=24.15.0`** is the `engines` floor | `.nvmrc` pins 26.7.0. Node 26 is Current, not LTS until 2026-10-28, so 24 LTS is supported and verified — see §6 |
| pnpm | **11.22.0** | `packageManager` field; pnpm 10+ self-switches |
| Postgres | **18** | local via `docker-compose`; hosted is RDS 18.4 — see DEPLOYMENT-CLOUD.md |
| Docker | any recent | only for the local database and the integration tests |

**Corepack does not work on 26.** It was unbundled from Node 25+, so
`corepack enable` is not the install path there. Use `npm i -g pnpm` — and note
that under nvm, global packages are per-Node-version, so pnpm has to be installed
while 26 is active.

```bash
nvm install 26.7.0 && nvm use 26.7.0
npm i -g pnpm
pnpm install
```

On **Node 24 LTS**, which the `engines` floor now admits, Corepack is still
bundled and is the shorter path:

```bash
nvm install 24.19.0 && nvm use 24.19.0
corepack enable          # self-switches to pnpm 11.22.0 via `packageManager`
pnpm install
```

Both were run on 2026-08-18. Development is expected to stay on 26 — `.nvmrc`
says so — and 24 exists for deploy targets that only offer LTS.

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
| `DATABASE_URL` | Hosted Postgres needs `sslmode=require` — the deployed RDS instance refuses anything else. See DEPLOYMENT-CLOUD.md §4.2 |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Two different values. `openssl rand -base64 32` twice |
| `SEED_USERS` | A JSON array. This is the **only** way an account is created — see §4 |
| `GOOGLE_CLIENT_ID` | Optional. Leave blank and the button is not rendered; password login still works |
| `UPLOAD_FILE_POLICY` | `pdf-only` (default) or `all-files`. The default is the restrictive one on purpose |
| `S3_ENDPOINT` | **Set to `http://localhost:9000` in the example file**, pointing at the MinIO in `docker-compose.test.yml` — which is what makes uploads work with no AWS account. Unset it for real AWS |
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
docker compose -f docker-compose.test.yml up -d   # Postgres 18 on :5433, MinIO on :9000
pnpm db:migrate                        # applies migrations
pnpm db:seed                           # provisions SEED_USERS, and the demo room
pnpm dev                               # api on :3000, web on :5173
```

Three things that are easy to get wrong here:

- **`apps/api/.env` is read by the scripts, not by the application.** Nothing in
  `src/` loads it: `loadConfig()` reads `process.env` and that is all. Until
  2026-08-17 nothing put the file *into* `process.env` either, so `pnpm dev:api`
  died with `Invalid environment … DATABASE_URL: received undefined` on a
  correctly configured machine. It went unnoticed because everything that had
  ever booted the API supplied the environment some other way — Prisma's CLI
  loads `.env` itself, the integration harness builds its config in-process, and
  `playwright.config.ts` passes every variable explicitly.

  `dev`, `debug` and `start` now pass `--env-file`. **`start:prod` deliberately
  does not**: configuration in a deployment comes from the platform, and a
  process that quietly prefers a baked-in file is how a staging container ends
  up pointed at a developer's database. Note that `--env-file` never overrides a
  variable that is already set, so the file cannot shadow the platform even
  where it is read.

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
| `pnpm db:seed` | The seed alone — accounts **and** the demo room. Safe to re-run |
| `pnpm db:reset` | Drops and rebuilds. **Never in production** |
| `pnpm test:e2e` | The Playwright journeys. Prepares its own database, then starts the API and the web app |

### Uploading locally

Uploads go **direct to the bucket** from the browser, so they need one. The
compose file runs MinIO for exactly this, and since 2026-08-19 `.env.example`
ships pointing at it — so a freshly copied file needs no S3 edit at all:

```
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=dataroom
AWS_ACCESS_KEY_ID=dataroom
AWS_SECRET_ACCESS_KEY=dataroom-secret
AWS_REGION=us-east-1
```

Those credentials are the container's own, hardcoded in the compose file, and
open nothing outside localhost. `S3_FORCE_PATH_STYLE` needs no setting — it
defaults to true whenever an endpoint is set.

Unset `S3_ENDPOINT` and the adapter talks to real AWS, which is the
deployed configuration; those five values then name a real bucket and an IAM
user's keys. The bucket is created by the `minio-init` container on
`docker compose up`, and its contents live in tmpfs — a restart is a clean
bucket, which is what you want locally and never in production.

### Running the web app with no backend

The front end can be developed, demonstrated and reviewed with **no API, no
database and no bucket running**:

```bash
cp apps/web/.env.example apps/web/.env.local
sed -i 's/^VITE_API_MODE=live/VITE_API_MODE=mock/' apps/web/.env.local
pnpm dev:web            # http://localhost:5173
```

Sign in with either fixture account — `ana@example.com` / `change-me-now`
(admin) or `bo@example.com` / `change-me-too`. The passwords are in
`apps/web/src/shared/mock/fixtures/users.json`; they are placeholders in a
committed fixture file and are not secrets.

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

### The demo room is seeded with them

The same step provisions the tree, the two user grants and the public link that
[`REVIEW.md`](REVIEW.md) is written against — `Project Meridian`,
`Project Northwind`, and the `/s/VBHV2KVG5Y9F5WZ9` link. Until 2026-08-19 that
dataset existed only as rows built by hand against the live deployment, so a
rebuilt database came up with accounts and an empty room list, and the two node
links printed in `REVIEW.md` pointed at nothing.

The fixture is [`apps/api/prisma/demo-tree.ts`](apps/api/prisma/demo-tree.ts) —
data only, with every id fixed, because two of them are published links and the
rest are what makes a re-seed recognise its own rows instead of building a
second room beside the first.

**There is no `SEED_DEMO` flag. The gate is the owner accounts.** Every node
hangs off a room owned by `ana.ruiz@example.com` or `bo.lindqvist@example.com`,
so a deployment whose `SEED_USERS` does not name both gets one line —
`Demo room skipped — … is not provisioned.` — and no rows. A flag would be a
second switch saying the same thing, and two switches eventually disagree.

Two properties worth knowing before running it against something you care about:

- **It creates what is missing and overwrites nothing.** A node a reviewer has
  renamed, moved or deleted stays as it is, and its children are placed under
  where the row *actually* is rather than where the fixture predicts.
- **No bytes are uploaded.** The file rows are real, sized and listed, and the
  whole permission matrix works — but nothing was PUT to the bucket, so
  downloading a seeded PDF gets a presigned URL that 404s. Upload through the
  app as Ana to get a file with bytes behind it.

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

# The demo room: 13 nodes and 3 grants, and a second run reporting "exists"
docker exec dataroom-postgres \
  psql -U postgres -d dataroom -tAc \
  "select (select count(*) from nodes), (select count(*) from shares)"
```

A second run reporting `created` rather than `unchanged` means the idempotency
check is broken, and a re-seed after a deploy would be silently resetting
passwords.

---

## 5. Hosted deployment

**Moved.** Everything about AWS and Vercel now lives in
[`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) — what is provisioned, the three
identities, the decisions taken while building it, the runbook, and teardown.

It was split out on 2026-08-18: this file is how to run the system on a laptop,
and that one is how it is hosted. They had grown into one document with two
audiences, and the hosted half is the half that changes every time something is
provisioned.

The short version: the web app is on **Vercel** (static build, one project, root
directory is the repository root), the API is a container on **AWS App Runner**
pinned to a single instance, Postgres is **RDS**, and blobs are in **S3** with
public access blocked. The constraints that bite — one instance, the unrevocable
presigned GET, the health check that must not touch the database — are in
[`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) §6 and repeated in §6 below where
they are also true locally.

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

Until 2026-10-28. ~~If a deploy target only offers LTS images, run 24 there and
relax the `engines.node` floor to `>=24.15.0`.~~ **Done, 2026-08-18** — the floor
is `>=24.15.0` in all five manifests, so an LTS-only target is no longer blocked.
`.nvmrc` still pins development to 26.7.0; 24 is permitted, not preferred.

The whole stack was re-verified on **24.19.0** rather than assumed: install under
`engine-strict`, typecheck, lint, build, 377 tests and the 20 journeys, plus the
two type-stripped entry points (`prisma/seed.ts` and the registry CLI) that were
designed against Node 26's rules. All 68 pinned packages were checked; none
exclude either version, and `24.15.0` is `jsdom@30`'s own floor on the 24 line.

One difference between the lines, which is why §1 lists two install paths:
**`corepack enable` works on 24** and does not on 26+.

---

## 7. CI

The suite is **red by design** until the last declaration lands — 556 declared,
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

- ~~**The web app has login and nothing else.**~~ ~~**The web app is what is
  missing**~~ — both stale, and left struck through rather than deleted because
  they were the headline of this section for two revisions. All seven web
  features are built and all twelve backend modules exist; 28 routes serve, and
  the twenty journeys drive the product through a real browser. What is
  unfinished is depth inside features, listed in
  [`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) §7.
- **The scheduler must run on exactly one instance**, and that is not yet
  enforced anywhere but in prose. `JOBS_SCHEDULER_ENABLED` is the switch; App
  Runner `minSize: 1` / `maxSize: 1` is the thing actually being relied on and
  nothing is deployed to set it. See [`jobs/TODO.md`](apps/api/src/jobs/TODO.md) §5
  before scaling the API service past one instance.
- **`users`, `nodes`, `shares`, `refresh_tokens` and `job_runs` exist** — five
  migrations, not the four this line claimed until 2026-08-17. The `nodes`
  storage strategy is decided — materialized path, six indexes, seven CHECK
  constraints — see [`nodes/TODO.md`](apps/api/src/nodes/TODO.md) §Storage.
- **`api-integration` needs Docker running.** `pnpm test` includes it, and its
  `global-setup` starts the compose service itself if it is not up, drops and
  recreates a separate `dataroom_test` database, and applies migrations with
  `migrate deploy`. CI gates on the three projects that need no database (§7).
- ~~`pnpm typecheck` is red in `apps/web`.~~ **Resolved.** All four packages
  typecheck clean as of the first web source file. `TS18003: No inputs were
found` is gone, so any typecheck failure from here on is a real one.
- **The S3 adapter has never talked to real S3.** `docker-compose.test.yml` runs
  **MinIO**, and `S3_ENDPOINT` points the adapter at it, so the upload path runs
  locally and `API-STORAGE-008..010` finally execute — but MinIO implements the
  same API and is not the same service. One difference is already visible: the
  presigned PUT carries an `x-amz-checksum-crc32` query parameter that MinIO
  ignores and S3 may not.
- **What is and is not provisioned** is tracked in
  [`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) §9, not here, so that the hosted
  state has one home and cannot disagree with itself in two files.
