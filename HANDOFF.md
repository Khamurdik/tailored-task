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

**84 files, ~4,500 lines of markdown, and zero lines of application source.**

| Exists | Does not exist |
| --- | --- |
| Module specs (`*/TODO.md`) for all 18 modules | Any `.ts` under `apps/*/src` |
| pnpm workspace, 5 packages, all configs | `prisma/schema.prisma` models |
| `pnpm-lock.yaml` — installed and resolved | Any test implementation |
| 511 declared tests in 87 groups, 66 of them `P0` | Any migration |
| Prisma datasource + generator block, `prisma validate` clean | |

**The toolchain has now been installed and run** (2026-08-16, Node 26.7.0, pnpm
11.22.0). That replaces the previous "verified only against the npm registry"
position and it immediately paid for itself — see §4. `pnpm -r lint` is clean;
`pnpm -r typecheck` fails only with `TS18003: No inputs were found` in the three
source-free packages, which is the correct result for a repo with no source and
will resolve itself with the first `.ts` file.

### Layout
```
apps/api/src/<module>/TODO.md     11 backend modules, L0–L4
apps/web/src/{shared,features/*}  7 frontend modules
packages/shared/                  the zod wire contract
tests/                            all 511 declarations, mirrors the module tree
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
| TypeScript **6.0.3** | 7.0.2 | TS 7 ships **without the programmatic compiler API**. `nest build` is an API consumer, and `typescript-eslint` (`>=4.8.4 <6.1.0`) *excludes* 7 in its peer range. A TS 7 pin fails resolution outright. Revisit at TS 7.1, which restores the API. (`ts-jest` was a third reason until Jest was removed — the case is now thinner than it looks.) |
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
  trivial. The cost — XSS reads **both** tokens, so what is stolen is seven days
  of access, not one — is written down in
  [`apps/api/src/auth/TODO.md`](apps/api/src/auth/TODO.md). The strict CSP is
  the mitigation that actually works; refresh rotation with reuse detection is
  after-the-fact detection, and server-side revocation only reaches the refresh
  family.
- **TTLs: access 1 day, refresh 7 days** (was 15 min / 7 days). The short access
  TTL was described as bounding the stolen-token window and did not, because the
  refresh token sits beside it in the same storage. The 1-day value is a
  deliberate trade of an ineffective bound for less churn; `auth/TODO.md` now
  says plainly that a JWT is not revocable and logout leaves an access token
  live for up to 24h.
- **Users are provisioned from `.env` by the Prisma seed step.** A SQL migration
  genuinely cannot do this: Prisma migrations are static checksummed SQL with no
  access to `process.env`, and Postgres cannot compute argon2id — `pgcrypto`
  offers bcrypt and (PG 18) sha-crypt only, and Neon will not install
  `pg_pwhash`/`pg_argon2id`. `prisma db seed` runs as part of `migrate dev` /
  `migrate reset`, so it stays inside the migration workflow.
- **Verified constraint (widened):** `prisma db seed` runs `node prisma/seed.ts`
  under Node 26 type stripping. Re-tested by execution on 26.7.0 — **four**
  things fail in the seed's transitive import graph, not one:
  decorators (`SyntaxError: Invalid or unexpected token` at the `@`),
  **parameter properties** (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`),
  **`enum`** (same error), and **extensionless relative imports**
  (`ERR_MODULE_NOT_FOUND`).
  The last is the sharp one: `apps/api` compiles under `moduleResolution:
  node10`, so all of `src/` is extensionless, and `.ts` specifiers cannot be
  added there because `allowImportingTsExtensions` requires `noEmit`. The
  parameter-property rule also rules out ordinary constructor injection, not
  just `@Injectable()`. Resolution is the **strip-safe zone** in
  `users/TODO.md`: two named leaf modules (`auth/password.ts`,
  `common/config/seed-users.schema.ts`), `prisma/seed.ts` importing them with
  explicit `.ts`, and a separate `apps/api/tsconfig.seed.json` so `nest build`
  never sees that file.

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
- ~~Multi-instance safety via `pg_try_advisory_lock`.~~ **Reverted.** The lock
  does not survive this stack — it is session-scoped, Prisma pools connections,
  and Neon's pooled endpoint is PgBouncer in transaction mode — and it
  contradicted the startup sweep, which cannot distinguish another instance's
  live run from a corpse. Decision: **one instance, pinned at the platform**
  (`minSize: 1`/`maxSize: 1`, plus a `JOBS_SCHEDULER_ENABLED` flag), with a
  stale-run guard (a `running` row older than `timeoutMs`, floor 1h, is dead) so
  a crash cannot wedge an `onOverlap: 'skip'` job forever. The scale-out upgrade
  path is written into `jobs/TODO.md` §5.
- **Verified:** `@nestjs/schedule@6.1.3` depends on `cron@4.4.0`, which is
  Luxon-based — `nextDate()` returns a Luxon `DateTime`, not a `Date`.

### 3.7 File types — enforced, behind a toggle
- **`UPLOAD_FILE_POLICY` is `pdf-only` (default) or `all-files`.** PDF-only was
  previously conditional prose ("*if* enforcing PDF-only") while the viewer was
  PDF-specific. It is now enforced by reading the object's leading bytes at
  `/complete`, and switchable by config because "can it hold other documents" is
  a product question, not a code question.
- **The disposition rule is deliberately outside the toggle.** Only
  `application/pdf` is ever served `inline`; everything else is `attachment`,
  under both policy values. Three separately-reasonable decisions compose into
  a bad one otherwise: uploads are served from the S3 origin, `inline` makes the
  browser render rather than download, and the viewer frames that URL — so under
  `all-files` an uploaded `.html` would execute on the bucket origin, where the
  web app's CSP (the mitigation the whole `localStorage` token decision rests
  on) cannot reach it. A config flag must not be able to open that path.

### 3.8 Share failures — one screen
- **Invalid, revoked, expired, deleted, and never-existed all render the same
  screen**, from byte-identical responses. Four distinct screens each confirm
  the token was real, which contradicts the system's 404-not-403 rule and
  `API-ACCESS-011`.
- Four screens are better product design and the cost of one screen falls on
  legitimate recipients. So the alternative is written into
  `public-view/TODO.md` along with the condition for taking it: **a written
  decision from the product owner, by email, naming the four states and
  accepting that each confirms a token existed.** This is a legal-discovery
  product; that decision needs a date on it. `WEB-PUBLICVIEW-006` is retired
  rather than deleted so reinstating it is a one-line change.

### 3.9 Audit — deferred
Explicitly out of scope, third priority behind `jobs` and `search`. The file
remains as a design note. Nothing depends on it (it is a pure listener), which
is what makes deferring it safe.

### 3.10 Tests — moved out of the modules
- All tests live in [`tests/`](tests/TODO.md). `apps/api` and `apps/web` carry no
  runner and no test dependency.
- Module `TODO.md` **Tests** sections remain as *requirements*, each pointing at
  its mirrored suite.
- **511 declarations in 87 groups**, declared in markdown tables that are both
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

**Now confirmed by a real install, not by arithmetic.** `pnpm install` resolved
692 packages with **zero peer warnings**, so the "57 peers, zero conflicts"
claim holds. Three things it found that no amount of registry-reading would
have:

- **The `onlyBuiltDependencies` allowlist was a silent no-op.** pnpm 11 uses
  `allowBuilds` (a map); it still *reads* the old list — `pnpm config get`
  returns it — but no longer acts on it. The install ended in
  `ERR_PNPM_IGNORED_BUILDS` naming Prisma and `@swc/core`, and pnpm rewrote
  `pnpm-workspace.yaml` with a stub block. Nothing actually broke, because every
  native binding here ships prebuilt (`@swc/core-linux-x64-gnu`,
  `@tailwindcss/oxide-linux-x64-gnu`), but the allowlist was protecting nothing.
  Fixed. `esbuild` and `unrs-resolver` were also on the list and are not in the
  tree at all — Vite 8 bundles with rolldown.
- **`apps/web` could not build.** `vite.config.ts` imported `defineConfig` from
  `vitest/config`, and `vitest` does not resolve from that package since the
  suite moved to `tests/`. Both `vite dev` and `vite build` failed to load their
  own config. It also still carried a `test` block pointing at a setup file and
  an `e2e/` directory that no longer exist. Fixed.
- **`prisma validate` passes** once `DATABASE_URL` is set — the schema is valid,
  extensions and all. The earlier failure was a missing env var, not a schema
  problem.

- 57 required peer constraints across the five `package.json` files resolve with
  **zero conflicts**; 68 pinned packages, none reject Node 26.
- `typescript-eslint@8.67.0` peer: `typescript >=4.8.4 <6.1.0`
- ~~`ts-jest@29.4.12` peer: `typescript >=4.3 <7`~~ — no longer a constraint;
  Jest was removed with the move to `tests/`. Kept struck through because it was
  cited as a reason for the TypeScript 6 pin long after it stopped applying.
- `@nestjs/platform-express@11.2.1` depends on `express@5.2.1` +
  `path-to-regexp@8.4.2` → **Express 5**, so bare `*` route wildcards throw at
  boot; use `{*splat}`.
- `jsdom@30` engines: `^22.22.2 || ^24.15.0 || >=26.0.0`
- Node 26.7.0 runs `.ts` natively. Under type-stripping, **four** things fail:
  decorators, parameter properties, `enum`, and extensionless relative imports.
  All four verified by execution, not by reading docs. See §3.4.
- pnpm 10+ blocks dependency lifecycle scripts — allowlist is in
  `pnpm-workspace.yaml` (`onlyBuiltDependencies`).
- Tailwind v4 has no config file; theme lives in `apps/web/src/index.css`.
  `tailwindcss-animate` → `tw-animate-css`; `tailwind-merge` must be v3.

---

## 5. Still open — decide before or during implementation

Everything in the previous revision of this list except item 1 has been settled;
see §3.7–§3.9 and the resolutions noted inline in the module specs.

1. **The `nodes` schema does not exist.** `nodes/TODO.md` says "schema per
   `docs/ARCHITECTURE.md`, plus all five indexes"; that document has no DDL and
   no index list. **This is the one genuinely open decision left**, and it is
   deliberately not blocking: `common`, `storage`, `packages/shared`, the test
   harness, and the registry/coverage gate can all be built first. Settle it
   before `nodes` itself.

   Two things have to land with it:
   - prefix `LIKE` only uses an index under `text_pattern_ops` or `C` collation,
     and every cascade in the system is a prefix query;
   - the cursor's collation must match the `ORDER BY` collation exactly.

2. **Does the event bus earn its keep?** `common` now owns it (see
   `common/TODO.md`), which resolves the ownership question — but `user.created`
   still has exactly one emitter (the seeder) and one listener, and login-time
   claiming is already declared as the guarantee. If the fast path is not worth a
   subsystem, delete the event and keep the login-time claim. Decide when
   `sharing` is written, not before.

3. **`pnpm -r typecheck` fails with `TS18003: No inputs were found`** in
   `packages/shared`, `apps/api`, and `apps/web`, because they contain no source.
   Correct behaviour, but it means the command is red today and a real error
   would not stand out. Resolves itself with the first `.ts` file; until then, do
   not read a red typecheck as a problem.

### Deferred deliberately — revisit, do not rediscover

- **Search × permissions × keyset pagination.** Filtering unreadable nodes
  before paginating is N queries per page, or a second copy of the grant logic
  in SQL. Also makes the keyset cursor unstable, since the filtered set is not a
  contiguous index range. `search` is optional; this is a reason to keep it so.
- **`node.deleted` carries an unbounded subtree id list**, and `revokeSubtree`
  takes an id array, in a system where every other cascade is a path prefix.
  Known performance problem, accepted for now.
- **Prefix-`LIKE` safety depends on fixed-width ids.** `/a/b` cannot match
  `/a/bc` only because every segment is a 36-char UUID. Nothing states this, and
  a later move to variable-length ids would break every cascade silently.
- **Google account linking is first-come-first-served.** Whoever first presents
  a Google identity matching a seeded email claims that account permanently,
  with no confirmation from an authenticated session. Out of scope for the
  assignment; a real deployment needs the confirmation step.
- **Test distribution still leans to the web.** `access` has 14 declarations and
  `web/explorer` has 80; web features hold 277 of 511. The `P0` set was rebuilt
  to correct for it (66 rows, weighted to the API security core — see
  `tests/TODO.md` §2), but the raw declaration counts were left alone. They are
  not wrong, just unevenly deep.

---

## 6. Working agreements observed this session

- **The user stages and commits.** Do not run `git add` or `git commit`.
- The user runs Node via **nvm**; 26.7.0 is installed.
- Specs come before code, and the user reviews spec changes before implementation.
- `npm-check-updates` is installed globally — **do not run `ncu -u`** on this
  repo; it would undo the four deliberate version holds.
