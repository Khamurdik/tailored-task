# Implementation status

**Read this first if you are picking up implementation.** It is the current
state of the code, everything learned by running it, and what to do next.

*Written 2026-08-17, after the session that took this repository from
specification-only to a booting API and a working login screen.*

| Document | What it is for |
| --- | --- |
| **this file** | Where the code is, what broke, what to do next |
| [`HANDOFF.md`](HANDOFF.md) §3 | The decision log — *why* things are the way they are |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How to run it; §8 is what does not work yet |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The only whole-system document |
| [`tests/TODO.md`](tests/TODO.md) | How the test registry and coverage gate work |
| `*/TODO.md` | Per-module contract, with ticked boxes for what exists |

---

## 1. State in one table

**556 declared tests · 156 implemented · 36 of 83 `P0`.** Lint clean in all four
packages, `pnpm -r typecheck` clean, `pnpm build` succeeds, the API boots and
serves, the web app builds and signs a user in.

| Module | Layer | State |
| --- | --- | --- |
| `packages/shared` | — | **Done.** Full contract, CJS + ESM, 12/12 contract tests |
| `common` | L0 | **Done.** Config, Prisma, errors, cursor, names, event bus, health |
| `storage` | L1 | **Done** offline. S3 adapter never run against a real bucket |
| `users` | L1 | **Done.** Repository, service, seeder, `users` table |
| `nodes` | L1 | **Done, no controller.** Materialized path, property test green |
| `access` | L2 | **Done, no controller.** Pure resolver, guard, codec, `shares` |
| `auth` | L2 | **Done.** 5 routes, refresh rotation, Google linking |
| `sharing` | L3 | Not started |
| `links` | L3 | Not started |
| `files` | L3 | Not started |
| `search` | L3 | **Deferred, out of scope** |
| `audit` | L4 | **Deferred, out of scope** |
| `jobs` | L4 | Not started |
| `web/shared` | — | **Done.** Client, token store, refresh lock, errors, keys, 10 UI primitives, mock data layer |
| `web/auth` | — | **Done.** Login, session bootstrap, route guards |
| `web/explorer` | — | Not started — **80 declarations, the largest suite** |
| `web/uploads` · `viewer` · `sharing` · `public-view` | — | Not started |

Four migrations applied: `init_users`, `add_nodes`, `add_shares`,
`add_refresh_tokens`. `job_runs` lands with `jobs`.

### Coverage by suite

```
suites/api/access         18/  20    suites/web/shared         44/  44
suites/api/auth           18/  28    suites/web/auth           35/  49
suites/api/common         11/  17    suites/contract           12/  12
suites/api/nodes           8/  21    suites/api/storage        10/  13
suites/api/{files,jobs,links,sharing,users,search}   0
suites/web/{explorer,public-view,sharing,uploads,viewer}   0
suites/journeys            0/  39
```

---

## 2. The single most important gap

**No HTTP route is node-scoped yet.** The tree works, the permission resolver
works, login works — and `NodeAccessGuard` **has never run in a real request.**
It is unit-tested and integration-tested through its collaborators, but no
controller carries `@RequireAccess()`.

That is the next thing to close, and it is why `sharing` + `links` are the right
next step rather than `explorer`: they give the guard its first controllers and
complete the path credential → grant → node.

The 10 `P0`s in `api/links` are the largest single block of unimplemented
security tests in the repo.

---

## 3. Run it

```bash
nvm use 26.7.0                     # Corepack does NOT work — see DEPLOYMENT §1
pnpm install
pnpm --filter @dataroom/shared build          # not optional, not automatic
docker compose -f docker-compose.test.yml up -d
pnpm --filter @dataroom/api exec prisma migrate deploy
pnpm --filter @dataroom/api exec prisma db seed
pnpm test
```

The web app runs with **no backend at all**:

```bash
cp apps/web/.env.example apps/web/.env.local
sed -i 's/^VITE_API_MODE=live/VITE_API_MODE=mock/' apps/web/.env.local
pnpm dev:web       # sign in as ana@example.com / change-me-now
```

`pnpm test` now includes `api-integration`, so **it needs Docker**. CI gates on
the three projects that do not (`gate`, `contract`, `api-unit`).

**A red suite is the resting state.** 400 of the 570 tests are the coverage gate
emitting one failure per unimplemented declaration. `pnpm declared` is the real
progress number.

---

## 4. Environment facts — do not rediscover these

Every one of these cost time. They are also in `HANDOFF.md` §4.

| | |
| --- | --- |
| **`localStorage` is `undefined`** under Node 26 + jsdom 30 | Node's own experimental Web Storage global has no backing file and shadows jsdom's. Polyfilled in `tests/src/support/web-setup.ts` — without it every token test passes by asserting nothing |
| **jsdom has no `navigator.locks`** | Polyfilled in the same file. Without it the client takes its documented per-tab fallback and `WEB-SHARED-028` asserts the weaker guarantee it exists to rule out |
| **Postgres 18 moved its data directory** | Mount `/var/lib/postgresql`, **not** `/var/lib/postgresql/data`. The old path makes the entrypoint report an "unused mount/volume" and exit 1 |
| **Compose maps host 5433 → container 5432** | Anything via `docker exec` must use 5432. Using 5433 there fails with "connection refused", which reads as "the database is down" |
| **`prisma migrate dev` does not always seed** | Only when it creates or resets the database. `pnpm db:seed` is the reliable step and is idempotent |
| **Prisma binds JS numbers as `bigint`** | `substring(text, bigint)` does not exist — cast `::int` explicitly in raw SQL |
| **`$executeRawUnsafe` sends params as jsonb** | `cannot cast type jsonb to uuid`. Use the tagged-template form |
| **Nest's `ValidationPipe` needs `class-validator`** | Deliberately absent. Use `ZodValidationPipe` from `nestjs-zod` |
| **`@node-rs/argon2` exports `Algorithm` as an ambient const enum** | `TS2748` under `isolatedModules`, and inlined by a compiler that does not exist during type stripping. argon2id is the default — do not pass the option |
| **Vitest does not read tsconfig `paths`** | Aliases are repeated in `tests/vitest.config.ts`. `@/` has a trailing slash so it cannot shadow `@web/` |
| **Vitest 4 removed the `basic` reporter** | Use `dot` or the default |
| **`consistent-type-imports` is off in `apps/api`** | `--fix` would erase the `design:paramtypes` metadata Nest DI needs, turning a lint tidy-up into a boot failure |
| **`moduleResolution: node10` errors on TS 6** | `TS5107`. `apps/api` acknowledges it with `ignoreDeprecations` (node10 is load-bearing for the strip-safe zone); `packages/shared` moved to `node16` |

---

## 5. Bugs found by running the code

Listed because each is a way to be wrong again.

**The property test earned its billing.** `API-NODES-001` found three bugs in
code that eight other passing tests never exercised:

1. **The name-conflict retry looped inside one transaction.** A constraint
   violation *aborts* a Postgres transaction, so every later statement fails
   with "current transaction is aborted" — including the read that finds a free
   name. Each attempt is now its own transaction.
2. **`isUniqueViolation` missed `P2010`.** A violation inside `$executeRaw`
   surfaces as Prisma's "raw query failed", with the real `23505` only in the
   message.
3. **The move `UPDATE` had never executed successfully.** Every earlier move
   test asserted a *rejection*, so the `bigint`/`substring` type error was
   invisible. **Eight green tests can coexist with a core statement that has
   never run.**

**Other real defects, all fixed:**

- **The `NODE_LOOKUP` binding in `docs/ARCHITECTURE.md` does not work.** Nest
  resolves a provider's dependencies in **its own** module's injector, not its
  parent's, so a token provided on `AppModule` is invisible to a guard declared
  in `AccessModule`. Now a `@Global() NodeLookupBindingModule` at the composition
  root. Both obvious alternatives reintroduce a forbidden import.
- **`compareChildren` never returned 0** for an identical row, so the keyset
  cursor put its own boundary row at the top of the next page.
- **The mock adapter ignored axios's `validateStatus`**, so it did not behave
  like a real adapter.
- **`data instanceof ArrayBuffer` is false under jsdom** for a genuine
  cross-realm `ArrayBuffer` — uploads silently stored zero bytes.
- **The coverage gate's scanner under-reported silently.** It paired quotes
  across a whole file, so one apostrophe in a prose comment swallowed every id
  after it. Four passing tests reverted to "unimplemented" and it looked like
  ordinary red.
- **`packages/shared`'s CJS build had never run**, and its ESM build emitted
  specifiers Node cannot resolve (worked in Vite, broke everywhere else).
- **A "redirect once" guard implemented with `setTimeout`** was racy and
  untestable; it now resets when a session is next stored.
- **The submit button swapped its label for a spinner**, changing its accessible
  name mid-action.
- **The integration harness listed modules and drifted within the hour.** It now
  boots `AppModule` itself, so it cannot test a composition that does not exist
  in production.

---

## 6. Decisions made this session

Full reasoning in `HANDOFF.md` §3.10–§3.19. The short version:

| Decision | Why |
| --- | --- |
| **`nodes` publishes a contract, not a schema** | Let everything above L1 proceed before the storage strategy was chosen — and when it was chosen, nothing above changed. `path` appears in exactly two files |
| **Materialized path** (user's call) | The whole system is prefix-shaped. Six indexes, seven CHECK constraints |
| **`links` split from `sharing`** (user's call) | Every route in `sharing` requires an owner; every route in `links` requires nobody. Opposite defaults in one controller is where a missing guard hides |
| **Short share codes: 16 Crockford chars, opt-in** | A grant is only as strong as its weakest credential — minting one takes a share from 256 bits to 80 |
| **`user.created` deleted** | The seeder is a *separate process* from the bus, so it could never have fired. Login-time claiming is not the fallback; it is the mechanism |
| **Event bus is a `Map`, not `@nestjs/event-emitter`** | Two events need no dependency, and deleting it later leaves nothing behind |
| **Mock data layer at the axios `adapter`** | The lowest seam still inside the front end, so interceptors and the refresh lock still run for real |
| **`@radix-ui/react-dialog` only** (user's call) | A button is a `<button>`; a dialog needs a real focus trap |
| **`INTERNAL` added to `ErrorCode`** | There was no code for a 500, and mapping those to `CONFLICT` would make `CONTRACT-004` pass while lying |
| **`RequestActor` lives in `common`** | Both L2 modules need it and neither may import the other |

### Specified but deliberately not built

- `NodeAncestryService`, `NodeStatsService` — each needed the repository and
  nothing else, so both were pass-throughs. Their operations are methods on
  `NodesService`. The path *format* did earn its own file.
- `user.created` — see above.

---

## 7. Dependencies added

The "68 pinned packages, zero peer conflicts" figure in `HANDOFF.md` §4 is
**no longer current**. Added, all pinned exactly, all with zero peer warnings:

- `apps/web`: `@radix-ui/react-dialog@1.1.23` (+24 transitive)
- `@dataroom/tests`: `zod`, `axios`, `@tanstack/react-query`, `react-router`,
  `react-hook-form`, `@hookform/resolvers`, `@nestjs/common`, `@nestjs/core`,
  `@nestjs/testing`, `@prisma/client`, `reflect-metadata`, `rxjs`

That second list is an inherent cost of tests living in their own package while
importing app source. It is not drift — each was added because a suite imports
the thing it names.

---

## 8. What to do next

In order. Each step's declarations are already written.

1. **`sharing` + `links` (L3).** Gives `NodeAccessGuard` its first controllers
   and closes credential → grant → node. 41 declarations, 16 of them `P0`,
   including the whole `api/links` indistinguishability group. `access` already
   provides everything both need — `SharesRepository`, `ShareCodec`,
   `findLiveByCredentialHash`, `bindPendingToUser`.
2. **A `nodes` controller.** List children, detail, create, rename, move,
   delete, stats — all behind `@RequireAccess()`. Unblocks `web/explorer`
   against the real API.
3. **`files` (L3).** Upload lifecycle. `storage` is done and waiting.
4. **`web/explorer`.** 80 declarations. Can be built against the mock
   (`VITE_API_MODE=mock`) or the real API; the mock already implements the tree,
   pagination, conflicts and share scoping.
5. **`web/uploads` → `viewer` → `public-view`.** Note `viewer` before
   `public-view`, which depends on it.
6. **`jobs` (L4).** Depends on `files`, so it genuinely cannot move earlier.
7. **`tests/src/reporters` + `history`**, then the Playwright journeys.

### Two known gaps in the harness

- **The coverage gate cannot see a test with no id at all.** It catches a *wrong*
  id, not a *missing* one. Recorded in `tests/TODO.md` §4 with the fix noted; the
  scanner would first need to tell a test title from a `describe` block.
- **`API-STORAGE-008..010` have never run.** They need a real S3 bucket. The S3
  adapter is written and exercised only through its in-memory twin.

### Still genuinely open

- **The boundaries lint rule.** The L0–L4 graph is the most-repeated claim in
  this repository and the only one nothing checks. Four static tests in
  `suites/api/access/boundaries.unit.spec.ts` cover part of it — no `shares`
  access outside `access`, no `editor` issued, `access` never imports `nodes`, no
  `forwardRef` anywhere — but there is no general rule. It would have caught the
  same-layer import that appeared and was removed while `links` was specified.
- **Four-screen share failures** still need a written product decision before
  `WEB-PUBLICVIEW-006` comes back — see `public-view/TODO.md`.

---

## 9. Working agreements

- **The user stages and commits.** Never run `git add` or `git commit`. Leave the
  tree dirty and report.
- Specs come before code, and the user reviews spec changes. Every module
  `TODO.md` has ticked boxes and an "Implementation notes" section recording what
  did not survive contact.
- **Do not run `ncu -u`.** Four version holds are deliberate — see
  `docs/TOOLCHAIN.md`.
- Node via nvm; 26.7.0. Global pnpm is per-Node-version under nvm.
- When a spec turns out to be wrong, **change the spec and say why** rather than
  quietly diverging. There are now nine such corrections in `HANDOFF.md` §3.
