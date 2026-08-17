# Deployment

How to run this system locally and how to put it somewhere. Kept current as
modules land — if a step here is wrong, that is a bug in this file.

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

Every command in §3 and §4 below has been run; the hosted sections in §5 are the
target and are marked as such. §8 tracks what is not yet true. `pnpm typecheck`
and `pnpm lint` are green across all four packages.

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
| `S3_ENDPOINT` | Unset for real AWS. Set to `http://localhost:9000` for the MinIO in `docker-compose.test.yml`, which is what makes uploads work with no AWS account |
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
pnpm db:seed                           # provisions SEED_USERS
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
| `pnpm db:seed` | The seed alone. Safe to re-run |
| `pnpm db:reset` | Drops and rebuilds. **Never in production** |
| `pnpm test:e2e` | The Playwright journeys. Prepares its own database, then starts the API and the web app |

### Uploading locally

Uploads go **direct to the bucket** from the browser, so they need one. The
compose file runs MinIO for exactly this; point the API at it:

```
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=dataroom
AWS_ACCESS_KEY_ID=dataroom
AWS_SECRET_ACCESS_KEY=dataroom-secret
AWS_REGION=us-east-1
```

Leave `S3_ENDPOINT` unset and the adapter talks to real AWS, which is the
deployed configuration. The bucket is created by the `minio-init` container on
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

**Nothing is provisioned.** The build artifacts now exist and are exercised
locally — `apps/api/Dockerfile` and `vercel.json`, both covered below — but no
account, bucket, database or service has been created, so this section is a
runbook for a deployment that has not happened rather than a record of one.

| Piece | Target | Why |
| --- | --- | --- |
| Web | Vercel | Static build, no server needed |
| API | AWS App Runner | Container, one instance — see §6 |
| Database | Neon | Postgres 18, scales to zero |
| Blobs | S3 | Presigned direct-to-browser, bucket never public |

### The API image

Built from the repository root, because `@dataroom/api` depends on
`@dataroom/shared` through `workspace:*` and a context rooted at `apps/api/`
cannot see it:

```bash
docker build -f apps/api/Dockerfile -t dataroom-api .
```

Four stages: install against the manifests alone so the layer caches, build
`shared` then the API, `pnpm deploy --prod` into a standalone tree, and a runner
holding that tree and nothing else. 593 MB, `node:26-slim` (which is Node 26.7.0
exactly, matching `.nvmrc`, and already carries the `libssl.so.3` that Prisma's
query engine needs — so there is no apt layer).

Three things in it are less obvious than they look:

- **`pnpm deploy` needs `--legacy`.** Since pnpm 10 it refuses to run unless the
  workspace sets `inject-workspace-packages=true`. Setting that would change how
  every local install links `@dataroom/shared`, which is a workspace-wide change
  to serve one container build.
- **The Prisma client is generated into the deployed tree**, from the deployed
  tree, by the CLI left behind in the build stage — `prisma` is a
  devDependency and so is absent from a `--prod` tree by definition. Generating
  it in `/app` instead would put it in a `node_modules` the final image never
  receives, and the failure would appear at the first query rather than at build.
- **The image runs `node dist/main`, not `pnpm start`** — see the `start:prod`
  note in §3.

It **does not** run migrations or the seed. Both stay the deliberate, separate
steps §4 describes: `migrate deploy` is not idempotent in the sense operators
assume, and `db:seed` is the only thing in the system that creates a user.

Verified by running, not by reading: the container boots with **no `.env` file
and platform environment only**, connects to Postgres, signs a user in (which
exercises the `@node-rs/argon2` native binding), completes a full upload through
the presigned PUT to a real bucket, and reports `healthy` on its `HEALTHCHECK`.

Set the App Runner service port to **3000** (the image's `PORT`), and remember
`minSize: 1` / `maxSize: 1` — §6 explains why that is a correctness requirement
rather than a cost one.

### The web app

`vercel.json` at the repository root carries the build, the `/api` rewrite and
the security headers. **Two placeholders must be replaced before the first
deploy** — `REPLACE-WITH-APP-RUNNER-HOST` (the rewrite destination) and
`REPLACE-WITH-BUCKET-HOST` (the bucket origin, which appears in `connect-src`
for the upload PUT and in `frame-src` for the PDF preview). Vercel does not
interpolate environment variables into `vercel.json`, so these are literals and
there is no way to defer them to a project setting.

Set the Vercel project's root directory to the **repository root**, not
`apps/web` — the build has to reach `packages/shared`.

The rewrite keeps the API same-origin in production, matching the dev proxy, so
`VITE_API_URL` should be left **unset** on Vercel. Setting it to the App Runner
host instead is a supported alternative, but then the browser talks
cross-origin: add that origin to `connect-src`, and add the Vercel origin to the
API's `CORS_ORIGINS`.

**The CSP is verified, not guessed.** The twenty journeys were run against the
production build served with exactly these headers and through the `/api`
rewrite, and all twenty pass — including `JOURNEY-001`'s upload (an XHR PUT to
the bucket origin) and `JOURNEY-005`'s preview (an `<iframe>` of a presigned URL
on that same origin), which are precisely what a wrong `connect-src` or
`frame-src` breaks. `script-src` carries no `'unsafe-inline'` and no
`'unsafe-eval'`; the built `index.html` contains no inline script, so nothing
needs them. **`style-src` does keep `'unsafe-inline'`** — Radix and React set
inline `style` attributes — and that is a real, stated weakening of §6's "ship
the CSP with no `unsafe-inline`", which is about scripts.

The Google directives (`accounts.google.com/gsi/*`) can be deleted outright if
Google sign-in stays disabled; nothing else references them.

One constraint to check before the first deploy: **`engines.node` is
`>=26.0.0`**, and Vercel may not offer Node 26 yet. The web build is static
output, so building it on 24 costs nothing — but the engines floor has to be
relaxed to `>=24.15.0` for that to be allowed, which is the same move §6
describes for the API.

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
- **Nothing has been provisioned.** The build artifacts exist and both are
  exercised locally — the API image boots, connects and uploads; the CSP in
  `vercel.json` was proven by running all twenty journeys against the production
  build behind it (§5). What has *not* happened is any account, bucket, Neon
  database or service. Until it does, §5 is a runbook rather than a record.
  ~~No S3 bucket has been created~~ — `docker-compose.test.yml` runs **MinIO**,
  and `S3_ENDPOINT` points the adapter at it, so the upload path runs locally
  and `API-STORAGE-008..010` finally execute. What is still untested is AWS S3
  *specifically*: MinIO implements the same API and is not the same service.
  One difference is already visible — the presigned PUT carries an
  `x-amz-checksum-crc32` query parameter that MinIO ignores and S3 may not.
- **`vercel.json` still holds two placeholder origins.** `REPLACE-WITH-APP-RUNNER-HOST`
  and `REPLACE-WITH-BUCKET-HOST` — the first deploy fails at the rewrite, and
  the second failure (a CSP that blocks uploads and the PDF preview) is quieter.
  See §5.
