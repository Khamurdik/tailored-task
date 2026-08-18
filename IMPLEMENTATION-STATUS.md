# Implementation status

**Read this first if you are picking up implementation.** It is the current
state of the code, everything learned by running it, and what to do next.

*Written 2026-08-17, after the session that took this repository from
specification-only to a booting API and a working login screen.*

| Document | What it is for |
| --- | --- |
| [`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) | **Start here.** What was built, what changed on contact, what is missing |
| **this file** | Where the code is, what broke, what to do next |
| [`IMPLEMENTATION-LOG.md`](IMPLEMENTATION-LOG.md) | *What happened*, in order, and what blocked it |
| [`HANDOFF.md`](HANDOFF.md) §3 | The decision log — *why* things are the way they are |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | How to run it; §8 is what does not work yet |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The only whole-system document |
| [`tests/TODO.md`](tests/TODO.md) | How the test registry and coverage gate work |
| `*/TODO.md` | Per-module contract, with ticked boxes for what exists |

---

## 1. State in one table

**570 declared tests · 394 implemented · 81 of 92 `P0`.** Lint clean in all four
packages, `pnpm -r typecheck` clean, `pnpm build` succeeds, the API boots and
serves, the web app builds and signs a user in.

*Updated after the session that built `tree`, `sharing`, `links`, `files` and
`jobs`, and covered `users`. **The backend is complete** — every module in the
layer graph exists. An owner creates a room and folders, uploads documents,
issues a link; a stranger opens it with no account, sees only that subtree and
downloads from it; the link dies the moment it is revoked; and six scheduled
jobs clean up behind all of it.*

| Module | Layer | State |
| --- | --- | --- |
| `packages/shared` | — | **Done.** Full contract, CJS + ESM, 12/12 contract tests |
| `common` | L0 | **Done.** Config, Prisma, errors, cursor, names, event bus, health |
| `storage` | L1 | **Done** offline. S3 adapter never run against a real bucket |
| `users` | L1 | **Done.** Repository, service, seeder, `users` table |
| `nodes` | L1 | **Done.** Materialized path, keyset listing, property test green |
| `access` | L2 | **Done.** Pure resolver, guard, **resolver service**, codec, `shares` |
| `auth` | L2 | **Done.** 5 routes, refresh rotation, Google linking |
| `tree` | L3 | **Done.** 9 `/nodes/*` routes behind `SessionGuard` + `NodeAccessGuard` |
| `sharing` | L3 | **Done.** Issue, list with inheritance, revoke, cascade, login-time claiming |
| `links` | L3 | **Done.** Anonymous resolve, uniform 404, throttle, no-store |
| `files` | L3 | **Done.** Upload lifecycle, magic-byte policy, rollups, reaper |
| `search` | L3 | **Deferred, out of scope** |
| `audit` | L4 | **Deferred, out of scope** |
| `jobs` | L4 | **Done.** Registry, runs as objects, 5 routes, 6 jobs, sweep + stale guard |
| `web/shared` | — | **Done.** Client, token store, refresh lock, errors, keys, 10 UI primitives, mock data layer |
| `web/auth` | — | **Done.** Login, session bootstrap, route guards |
| `web/explorer` | — | **Browsing, create, rename, delete, `readOnly`.** 32/81 — no drag, bulk, keyboard, or optimistic updates |
| `web/uploads` | — | **Drop, pick, progress, cancel, retry.** 19/47 — no per-row drop, directory drops, or cross-tab mirror |
| `web/viewer` | — | **PDF preview, download, expiry recovery.** 17/19 |
| `web/sharing` | — | **Mint, invite, list, revoke.** 18/30 — no expiry picker or row indicator |
| `web/public-view` | — | **`/s/:code`, read-only, one failure screen.** 14/28 |

Five migrations applied: `init_users`, `add_nodes`, `add_shares`,
`add_refresh_tokens`, `add_job_runs`.

### Coverage by suite

```
suites/api/access         18/  20    suites/web/shared         44/  44
suites/api/auth           18/  28    suites/web/auth           35/  49
suites/api/common         12/  18    suites/contract           12/  12
suites/api/nodes          22/  28    suites/api/storage        14/  14
suites/api/sharing        20/  20    suites/api/links          22/  23
suites/api/files          22/  22    suites/api/jobs           24/  24
suites/api/users          15/  15    suites/api/search          0/   9
suites/web/explorer       32/  81    suites/web/uploads        19/  47
suites/web/viewer         17/  19    suites/web/sharing        18/  30
suites/web/public-view    14/  28
suites/journeys           16/  39
```

**Every API suite is complete except four, and each is short for a stated
reason:**

- `api/links` 22/23 — `API-LINKS-023` is `P2` and deliberately unimplemented.
  Getting it right means the throttle returns 404 rather than 429, which removes
  a genuinely useful signal from legitimate clients; the row exists to make the
  trade visible, not to be taken.
- `api/search` 0/9 — the module is deferred and out of scope.
- `api/auth` 18/28, `api/common` 12/18, `api/nodes` 22/28, `api/access` 18/20 —
  ordinary unwritten coverage against finished modules. **24** declarations
  between them, and ~~none `P0`~~ **seven are `P0`**: `API-ACCESS-010`,
  `API-ACCESS-011`, `API-AUTH-002`, `API-AUTH-018`, `API-COMMON-014`,
  `API-NODES-010`, `API-NODES-014`. The behaviour each names is exercised
  somewhere — the byte-identical 404, for instance, is asserted through
  `API-NODES-022` against a real request — so none of them is an unguarded
  feature. They are the cheapest `P0` movement available and they are listed here
  rather than counted, because "none `P0`" was wrong and reads as "nothing left
  worth doing". `node src/registry/cli.ts --all` prints the current set.

Twelve declarations were added while building. None is padding: seven cover the
request pipeline, which could not be asserted before a route existed; three cover
leaks or defects found while building (`API-SHARING-020`, `API-SHARING-021`,
`API-COMMON-018`); two cover the upload policy toggle from the `files` side.

---

## 2. The single most important gap

~~**No HTTP route is node-scoped yet.**~~ **Closed.** `tree` gives
`NodeAccessGuard` nine routes, and `API-NODES-022` asserts the byte-identical
404 against a real request rather than against the guard in isolation.

Closing it found two ways the guard could be perfectly correct and the system
still wrong, both now `P0` declarations:

- **`POST /nodes/folders` names its parent in the request body**, so the guard —
  which reads route parameters — never fired for it. Any authenticated caller
  could create a folder in anybody's room.
- **`PATCH /nodes/:id/parent` names its destination in the body.** The guard
  authorized the node being *moved* and said nothing about where it landed, so a
  node could be moved into a room the caller has no access to.

Both are closed by calling `NodeAccessResolver` — the same method the guard
calls, extracted for exactly this — rather than by a second hand-written check.

~~**The gap now is `sharing` + `links`.**~~ **Also closed.** Both are built and
all 41 declarations pass, including every one of the 16 `P0`s. `API-SHARING-002`
— "a token for folder B requesting sibling C returns 404", the test a reviewer
tries by hand — is green, along with `API-LINKS-004`, the single comparison that
would catch the indistinguishability design failing.

~~**The gap now is `files`.**~~ **Closed.** 22/22, including the rollup
maintenance the listing depended on.

**The gap is the web app**, and it is now the only one. **The backend is
complete** — every module in the layer graph is built and every API suite is
green.

**The owner's product works end to end in the browser**, against the mock:
sign in, create a room and folders, upload PDFs with real progress, preview them,
download them, rename, move and delete. That is `explorer` + `uploads` +
`viewer`.

What remains is the half a *recipient* sees. **`web/sharing`** (30 declarations)
is the dialog that mints a link, and **`web/public-view`** (28, six of them `P0`)
is the read-only page at `/s/:code` — the screen the whole product exists to
produce, and the only one a stranger ever reaches. Neither is written, so a link
can only be minted with `curl`.

Also unfinished, each unticked with a reason in its module `TODO.md`:
`explorer` has no drag-move, bulk selection, keyboard navigation or optimistic
updates; `uploads` has no per-row drop target, directory expansion or cross-tab
mirror.

The mock data layer is what makes that tractable rather than alarming: the web
app already runs end to end against `VITE_API_MODE=mock`, which implements the
tree, pagination, conflicts, upload lifecycle and share scoping. Every feature
below can be built against it and then pointed at the real API by changing one
environment variable.

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

**A red suite is the resting state.** The ~296 failures in a full run are the
coverage gate emitting one per unimplemented declaration; every other test file
is green. `pnpm declared` is the real progress number.

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
| **Rate limiting cannot be switched off with `overrideGuard` or `overrideProvider`** | `ThrottlerGuard` is registered under `APP_GUARD`, and Nest collects enhancer providers into `ApplicationConfig` at scan time — both overrides silently no-op and the suite fails with 429s that read as permission bugs. Replace `ThrottlerStorage` instead: `createTestApp({ withoutThrottling: true })` |
| **Concurrent supertest calls on one server race** | `request(server)` calls `listen()` on the server it is handed, so a `Promise.all` of requests dies with `ECONNRESET`/`ECONNREFUSED`. Drive them sequentially |
| **Any `WORD-123` in a test title is read as a declaration id** | "…a SHA-256 of the token…" registered as an implementation of a test called `SHA-256`. The gate reports it as "implemented but never declared" rather than miscounting, so it is loud — but do not spell digests that way in a title |
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

**Found by building `tree` — four, and every one lived in code that had never
executed.** The pattern from the property test repeats exactly: a suite can be
green while a core statement has never run.

1. **Every cursor this system produced was invalid under its own contract.**
   `encodeCursor` emitted `base64url(payload).base64url(hmac)`; `CursorSchema` is
   `z.base64url()`, and `.` is not in that alphabet. A client parsing the
   response would have rejected the page it had just been handed. `API-COMMON-010`
   round-trips the encoder against the decoder, and two functions that agree with
   each other can both disagree with the schema. The signature is now appended as
   raw bytes and the whole thing encoded once — one base64url token, which is
   what the contract always said a cursor was. `API-COMMON-018` pins it.
2. **`CursorSchema`'s 512-character bound was too small for a legitimate cursor.**
   A cursor carries a name, names run to 255 *characters*, and a Cyrillic or CJK
   name at the cap is ~1020 bytes — so the cursor is ~1500 characters. Pagination
   would have failed on page two, only in some folders, only in some languages.
   The bound is now derived from `MAX_NAME_LENGTH` rather than picked.
3. **`ORDER BY "type"` sorted by the wrong column.** The listing selects
   `"type"::text AS "type"`, and Postgres resolves an unqualified `ORDER BY` name
   against the **output** columns first — so it sorted the text label and put
   files before folders alphabetically, reversing the rule the enum's declaration
   order exists to provide. Qualified as `"nodes"."type"` now.
4. **`listSubtree` returned `undefined` for every `@map`ped field.** It was
   `SELECT *` through `$queryRaw`, which yields the *database's* column names, so
   `root_id` never became `rootId`. Invisible because its only caller reads
   `depth`, which is spelled the same either way — and it would have become a
   silent wrong answer for whoever read the second field.

**Found by building `sharing` and `links` — three, all in the seam between
modules rather than inside one:**

1. **Breadcrumbs named every folder above a share.** `NodeAccessGuard` resolved a
   visitor's *role* perfectly and had nothing to say about what a response may
   contain, so the trail was built from the room root: a visitor given
   `Q4` saw `Project Meridian / Diligence / Q4`, which is the shape of the
   owner's room handed to a stranger. `AccessContext.grantNodeId` carries the
   answer now, read out of the grant the guard had already resolved, so it costs
   no query. `API-SHARING-021`.
2. **`@RequireAuth()` on the sharing controllers answered 401 where the system
   answers 404.** A share visitor attempting to re-share learned that the route
   existed and their credential was the wrong kind — a different answer than the
   one a signed-in stranger gets, and therefore a way to tell two situations
   apart that everything else is careful to keep identical. `@RequireAccess('own')`
   already excluded them, through the single 404.
3. **`CreatedShareSchema.token` could not describe a `user` grant.** It was
   `z.string()`, the database forbids a token on a user grant
   (`shares_kind_shape`), and the placeholder data layer returned `''` to bridge
   the gap. An empty string is not a token.

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

1. ~~**A `nodes` controller.**~~ **Done — it is `tree`.** It moved ahead of
   `sharing` because `sharing`'s scoping tests need a *readable* node route and
   every route `sharing` exposes is `@RequireAccess('own')`, which a share token
   can never satisfy.
2. ~~**`sharing` + `links` (L3).**~~ **Done.** 41 declarations, all green,
   including all 16 `P0`s.
3. ~~**`files` (L3).**~~ **Done.** 22 declarations, all green, including the
   rollup maintenance.
4. **`web/explorer`.** 80 declarations. Can be built against the mock
   (`VITE_API_MODE=mock`) or the real API; the mock already implements the tree,
   pagination, conflicts and share scoping.
5. **`web/uploads` → `viewer` → `public-view`.** Note `viewer` before
   `public-view`, which depends on it.
6. ~~**`jobs` (L4).**~~ **Done.** 24 declarations, all green. It could not have moved earlier: `reap-pending-uploads` and `hard-delete-expired` both need `files`.
7. **`tests/src/reporters` + `history`**, then the Playwright journeys.

### Two known gaps in the harness

- **The coverage gate cannot see a test with no id at all.** It catches a *wrong*
  id, not a *missing* one. Recorded in `tests/TODO.md` §4 with the fix noted; the
  scanner would first need to tell a test title from a `describe` block.
- **`API-STORAGE-008..010` have never run.** They need a real S3 bucket. The S3
  adapter is written and exercised only through its in-memory twin.

### Still genuinely open

- **~64 declarations are unwritten tests against modules already marked Done** —
  `api/users` alone has 16 with 4 `P0` for a module that has been finished since
  the first session. The `implemented / declared` ratio reads as "a third of the
  product", and a meaningful slice of the gap is coverage rather than features.
  Cheap, and it is the fastest `P0` movement available.

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
