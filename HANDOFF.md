# Handoff

A record of the design session that produced this repository, written so a new
session (or a new person) can pick it up without re-deriving anything.

This is a **reconstruction of decisions, not a transcript.** Where a fact was
verified rather than assumed, it says how and when.

*Written 2026-08-16. Repo state at commit `55d6a24`.*

---

## 1. What this project is

A **virtual data room** — the due-diligence kind. An owner uploads documents into
a folder tree and grants outsiders scoped, revocable, read-only access to part of
it. It is a take-home engineering assignment; the prose in the specs addresses
"the brief" and "reviewers", and the module docs deliberately double as the
design-record deliverable.

Read in this order:
1. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the only whole-system document
2. [`README.md`](README.md) — module index and build order
3. [`PROJECT-ANALYSIS.md`](PROJECT-ANALYSIS.md) — independent critique, including
   the contradictions still open
4. [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md) — every version pin and why
5. [`tests/TODO.md`](tests/TODO.md) — how testing works here

---

## 2. Current state

**81 files, ~3,800 lines of markdown, and zero lines of application source.**
Everything is committed; the working tree is clean.

| Exists | Does not exist |
| --- | --- |
| Module specs (`*/TODO.md`) for all 18 modules | Any `.ts` under `apps/*/src` |
| pnpm workspace, 5 packages, all configs | `prisma/schema.prisma` models |
| Pinned dependency graph, peer-verified | `pnpm-lock.yaml` (never installed) |
| 498 declared tests in 87 groups | Any test implementation |
| Prisma datasource + generator block | Any migration |

**Nothing has ever been installed or run.** The machine used for the session had
Node v20.15.0; this project requires Node 26. Every verification was done by
querying the npm registry and by semver-checking constraints, never by installing.

### Layout
```
apps/api/src/<module>/TODO.md     11 backend modules, L0–L4
apps/web/src/{shared,features/*}  7 frontend modules
packages/shared/                  the zod wire contract
tests/                            all 498 declarations, mirrors the module tree
docs/                             ARCHITECTURE, TOOLCHAIN
```

---

## 3. Decision log

Chronological. Each entry is a decision that a new session should not relitigate
without reading the reason.

### 3.1 Repository and tooling
- **Git initialised on `main`**, `.gitignore` + `.gitattributes` written. Git is
  2.25.1, which predates `init.defaultBranch`, so the branch was set with
  `git symbolic-ref` before the first commit.
- **pnpm workspace**, five packages: `apps/api`, `apps/web`, `packages/shared`,
  `tests`, root. No Turbo/Nx — fewer moving parts.
- **Every dependency pinned exactly** (no `^`, no `~`).

### 3.2 The four version pins that go against "latest"
Verified against the npm registry on 2026-08-16.

| Pin | Instead of | Why |
| --- | --- | --- |
| TypeScript **6.0.3** | 7.0.2 | TS 7 ships **without the programmatic compiler API**. `nest build` is an API consumer, and both `ts-jest` (`>=4.3 <7`) and `typescript-eslint` (`>=4.8.4 <6.1.0`) *exclude* 7 in their peer ranges. A TS 7 pin fails resolution outright. Revisit at TS 7.1, which restores the API. |
| Prisma **6.19.3** | 7.9.1 | Prisma 7 is ESM-only, mandates a driver adapter, and requires `prisma.config.ts`. Its upgrade guide has no CommonJS path; NestJS builds CJS. Prisma 6 holds the `prev` dist-tag and is maintained. |
| Vitest **only** | Jest for the API | Chosen when tests moved to `tests/`. esbuild cannot emit `emitDecoratorMetadata`, so `unplugin-swc` transforms the `api-*` projects. |
| `@vitejs/plugin-react-swc` | `@vitejs/plugin-react` | The latter pins `vite: ^8.0.0` and drags Babel peers. |

### 3.3 Runtime — Node 26
- `.nvmrc` = **26.7.0**. All 68 pinned packages checked; 35 declare
  `engines.node` and none exclude 26.
- **Node 26 is Current, not LTS** until 2026-10-28. If a deploy target only
  offers LTS images, run 24 there and relax the `engines` floor to `>=24.15.0`.
- **Corepack is unbundled from Node 25+.** `corepack enable` does not work.
  Use `npm i -g pnpm`; pnpm 10+ self-switches via the `packageManager` field.
- Under nvm, globals are per-Node-version, so pnpm must be installed under 26.

### 3.4 Auth — revised mid-session on the user's instruction
- **No registration.** No `POST /auth/register`, no sign-up UI.
- **Email + password is primary**, argon2id via `@node-rs/argon2`.
- **Google login is secondary and links to an existing account.** It must never
  create a user, and must reject `email_verified: false`.
- **No cookies.** Bearer tokens in `localStorage`; refresh token travels in the
  request body. This removes CSRF entirely and makes mobile/native clients
  trivial. The cost — XSS can read the token — is written down in
  [`apps/api/src/auth/TODO.md`](apps/api/src/auth/TODO.md) along with the
  mitigations that make it acceptable (strict CSP, 15-min access TTL, refresh
  rotation with reuse detection, server-side revocation on logout).
- **Users are provisioned from `.env` by the Prisma seed step.** A SQL migration
  genuinely cannot do this: Prisma migrations are static checksummed SQL with no
  access to `process.env`, and Postgres cannot compute argon2id — `pgcrypto`
  offers bcrypt and (PG 18) sha-crypt only, and Neon will not install
  `pg_pwhash`/`pg_argon2id`. `prisma db seed` runs as part of `migrate dev` /
  `migrate reset`, so it stays inside the migration workflow.
- **Verified constraint:** `prisma db seed` runs `node prisma/seed.ts`. Node 26
  runs plain `.ts` natively with no flag, but **type-stripping cannot parse
  decorators** (`SyntaxError` at the `@`). Tested on 26.7.0. The argon2 helper
  the seed imports must therefore be a plain `auth/password.ts` module, never an
  `@Injectable()` service.

### 3.5 Knock-on effects of removing registration
- `sharing` previously bound pending email grants on `user.registered`, an event
  that can no longer fire. It now binds on **both** `user.created` (fast path)
  and successful login (the guarantee) — because a hand-written `INSERT` emits
  no event, and those grants would otherwise stay pending forever.
- `auth` emits `user.authenticated` so `sharing` can listen without `auth`
  depending upward on L3.

### 3.6 Jobs — made explicit on the user's instruction
- Schedules are a `JOBS: JobDefinition[]` registry registered through
  `SchedulerRegistry`. **No `@Cron()` decorators** — a decorator cannot be
  listed, overridden per environment, or hand-triggered.
- Every run is a `job_runs` row with a terminal status
  (`running | succeeded | failed | timed_out | skipped | interrupted`).
- `POST /jobs/:id/run` returns 202 + `runId`; the caller polls.
- `is_admin` added to `users`, settable only by the seeder. Non-admins get 404.
- Multi-instance safety via `pg_try_advisory_lock`, replacing the old
  "one instance only" assumption.
- **Verified:** `@nestjs/schedule@6.1.3` depends on `cron@4.4.0`, which is
  Luxon-based — `nextDate()` returns a Luxon `DateTime`, not a `Date`.

### 3.7 Audit — deferred
Explicitly out of scope, third priority behind `jobs` and `search`. The file
remains as a design note. Nothing depends on it (it is a pure listener), which
is what makes deferring it safe.

### 3.8 Tests — moved out of the modules
- All tests live in [`tests/`](tests/TODO.md). `apps/api` and `apps/web` carry no
  runner and no test dependency.
- Module `TODO.md` **Tests** sections remain as *requirements*, each pointing at
  its mirrored suite.
- **498 declarations in 87 groups**, declared in markdown tables that are both
  the human doc and the machine registry.
- Driven by, in priority order: security checks → user stories → invariants →
  contracts. Explicitly not by internal structure.
- **The first run must be red.** A registry parser plus a coverage gate emits one
  failing test per declared-but-unimplemented ID, so progress is
  `implemented / declared`, not a percentage of whatever tests exist.
- **Run history is files, not a database**: `tests/runs/index.jsonl` (committed)
  plus per-run payloads (ignored). Interim, the built-in JSON reporter already
  writes `runs/latest.json`.

---

## 4. Verified facts worth not re-checking

All as of 2026-08-16, verified against the live npm registry / by execution.

- 57 required peer constraints across the five `package.json` files resolve with
  **zero conflicts**; 68 pinned packages, none reject Node 26.
- `typescript-eslint@8.67.0` peer: `typescript >=4.8.4 <6.1.0`
- `ts-jest@29.4.12` peer: `typescript >=4.3 <7`
- `@nestjs/platform-express@11.2.1` depends on `express@5.2.1` +
  `path-to-regexp@8.4.2` → **Express 5**, so bare `*` route wildcards throw at
  boot; use `{*splat}`.
- `jsdom@30` engines: `^22.22.2 || ^24.15.0 || >=26.0.0`
- Node 26.7.0 runs `.ts` natively; decorators in `.ts` fail under type-stripping.
- pnpm 10+ blocks dependency lifecycle scripts — allowlist is in
  `pnpm-workspace.yaml` (`onlyBuiltDependencies`).
- Tailwind v4 has no config file; theme lives in `apps/web/src/index.css`.
  `tailwindcss-animate` → `tw-animate-css`; `tailwind-merge` must be v3.

---

## 5. Still open — decide before or during implementation

Ordered by how expensive they are to discover late. Items 1–5 are from
[`PROJECT-ANALYSIS.md`](PROJECT-ANALYSIS.md) §6 and are **unresolved**.

1. **The `nodes` schema does not exist.** `nodes/TODO.md` says "schema per
   `docs/ARCHITECTURE.md`, plus all five indexes"; that document has no DDL and
   no index list. This is the largest hole and blocks almost everything.
2. **Two modules claim the `node.deleted` listener.** `nodes/TODO.md` says
   `access` revokes grants; `sharing/TODO.md` and the README say `sharing` does.
3. **No module owns the event bus.** `user.created`, `user.authenticated`,
   `node.deleted` (and the node lifecycle events audit would have used) have no
   emitter and no payload contract. `common` is the natural home.
4. **`common` declares "depends on nothing"** while needing zod and the shared
   `ErrorCode` union.
5. **Versioning is half-specified** — the S3 key scheme includes `{versionId}`
   and `files` says never to delete an object referenced by a version, but no
   module owns a versions table.
6. **`Role` is never defined.** `access` owns it; the union's values and their
   mapping to `@RequireAccess('read'|'write'|'own')` appear nowhere.
7. **Constants unvalued**: `MAX_FILE_SIZE`, `MAX_NAME_LENGTH`, `PAGE_SIZE`.
   Only `MAX_DEPTH` (32) and the GET TTL (60s) are pinned.
8. **PDF-only is left conditional** ("*if* enforcing PDF-only") while the viewer
   is PDF-specific. It changes validation, the viewer, and the error taxonomy.
9. **Google config**: currently optional — the button hides when
   `VITE_GOOGLE_CLIENT_ID` is unset. Confirm that, or make it required.
10. **Integration-test database**: `testcontainers` vs a docker-compose Postgres
    vs a disposable Neon branch. Not chosen.
11. **`API-AUTH-005`** (login timing must not distinguish unknown-email from
    wrong-password) is inherently flaky as a strict assertion. Implement as a
    coarse bound or skip with a written reason.
12. **`ARCHITECTURE.md` is duplicated** byte-identically at the root and in
    `docs/`. Every cross-reference points at `docs/`; delete the root copy.

---

## 6. Working agreements observed this session

- **The user stages and commits.** Do not run `git add` or `git commit`.
- The user runs Node via **nvm**; 26.7.0 is installed.
- Specs come before code, and the user reviews spec changes before implementation.
- `npm-check-updates` is installed globally — **do not run `ncu -u`** on this
  repo; it would undo the four deliberate version holds.
