# tests — the whole suite, declared before it is written

> **Status: nothing is implemented.** Every suite below is a declaration. The
> first run is meant to be entirely red — see §4. Do not write test bodies until
> the declarations for that module are agreed.

## Why tests live here and not next to the code

A test beside its module tends to be written *after* that module, and it tends
to assert what the code already does. Pulling the whole suite into one project
changes what it can be:

- **Tests come first.** A suite declared before its module exists cannot assert
  current behaviour, because there isn't any. It can only assert the contract.
- **One vocabulary.** `access` and `sharing` disagreeing about what "revoked"
  means is visible when both suites sit in one folder, and invisible when they
  sit in two module directories.
- **One runner, one report, one history.** A single run log covering the API,
  the web app, and the journeys is what makes "is this better than last week"
  answerable.
- **The app packages stay production-only.** No test dependency reaches
  `apps/api` or `apps/web`; their `package.json` files carry no runner.

The module `TODO.md` files keep their **Tests** sections. Those are the
*requirements* — the module author's statement of what must be true. This
project is where those become addressable, traceable, executable items.

---

## 1. Layout

```
tests/
├── suites/
│   ├── contract/          packages/shared — the wire format
│   ├── api/<module>/      one folder per backend module
│   ├── web/<feature>/     one folder per frontend feature
│   └── journeys/          user stories, end to end (Playwright)
├── src/
│   ├── support/           harness: fixtures, factories, app boot, fakes
│   ├── reporters/         the run-log reporter
│   ├── registry/          declaration parser + coverage gate
│   └── history/           CLI for reading past runs
└── runs/                  the file-based run log. No database.
```

File naming decides which project runs a file, so it is not cosmetic:

| Pattern | Project | Environment | Cost |
| --- | --- | --- | --- |
| `src/registry/**/*.spec.ts` | `gate` | node | ms |
| `suites/contract/**/*.spec.ts` | `contract` | node | ms |
| `suites/api/**/*.unit.spec.ts` | `api-unit` | node, no I/O | ms |
| `suites/api/**/*.int.spec.ts` | `api-integration` | node + real Postgres | seconds |
| `suites/web/**/*.spec.tsx` | `web-unit` | jsdom | ms |
| `suites/journeys/**/*.spec.ts` | Playwright | real browser | tens of seconds |

---

## 2. How a test is declared

Every suite `TODO.md` carries a **`## Declared tests`** section. It is the
single source of truth — human-readable documentation *and* the machine
registry. There is no second list to keep in sync.

Inside it, declarations are split into **groups** under `###` headings. A group
is one coherent thing a user is trying to do — "Creating a folder", "Cancelling
and retrying", "What a visitor must not see". Grouping matters because the list
is long and deliberately repetitive: a dozen rows for one dialog is correct when
each row is a different way that dialog is used, and without groups nobody can
tell whether a case is missing.

```
| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-ACCESS-003 | Grant on a grandparent resolves on a grandchild | unit | P0 |
```

- **ID** — `AREA-MODULE-NNN`. Stable forever. Never renumber; retire instead.
  The ID appears in the test title so a run log line maps back to a declaration.
- **Behaviour** — one sentence, stated as an observable outcome. If it needs
  "and", it is two tests. Never names a function; names a behaviour.
- **Kind** — `unit` · `integration` · `property` · `security` · `journey`
- **Pri** — `P0` must pass before the module is considered done · `P1` should ·
  `P2` nice to have

### `P0` is deliberately rare

**76 of 534.** An earlier revision had 332, which is not a prioritisation — if
two thirds of the suite blocks a module, nothing does. A row earns `P0` only if
its failure is one of:

- **a leak** — a node, a token, or the existence of a user or id escapes
- **silent corruption** — the tree, a path, a counter, or a stored hash goes
  wrong and nothing surfaces it until much later
- **the product not working at all** — sign in, share, open the link

Everything else is `P1`, which still means *write it*. The point of the split is
that `green / P0` answers "can this ship" and `green / declared` answers "how
far along is it". Two different questions, and one number cannot serve both.

The distribution that falls out is the intended one: `links` 10, `auth` 9,
`nodes` 8, `access` 7, `sharing` 6, `public-view` 6 — and `explorer`, the
largest suite in the repo at 80 rows, has exactly 1.

`links` topping that list is not a new suite written over-enthusiastically. It
is the only module whose entire input arrives from someone who was never
authenticated, and nearly everything it can get wrong is a leak.

### Format rules the parser depends on
- [ ] Tables live under a `## Declared tests` heading
- [ ] Each `###` heading inside that section opens a group; rows belong to the
      nearest preceding `###`. A suite with no `###` is one group named after
      the suite
- [ ] IDs match `^[A-Z]+(-[A-Z0-9]+)*-\d{3}$` and are globally unique
- [ ] IDs are stable across regrouping. Moving a row into a different group
      keeps its number — the number is the identity, the group is only where it
      currently reads best
- [ ] A declaration is never deleted once implemented — it is the requirement.
      To drop one, mark it `RETIRED` in the Behaviour cell and keep the row

### Why so many near-duplicates
Several rows assert overlapping things on purpose. A folder-create with a
duplicate name, a blank name, and a 300-character name are three rows because
they fail in three different layers — client validation, server constraint, and
database index — and a single "rejects bad names" test passes while two of the
three are broken. Where rows genuinely restate one property reached by different
routes, the suite's Notes say so rather than hiding it.

---

## 3. What drives the declarations

In priority order. Each suite states which of these a test came from.

1. **Security checks.** Anything that could leak a node, a token, or the
   existence of a user. These are `P0` regardless of how unlikely they look, and
   they are the tests most worth writing before the code.
2. **User stories.** "An owner shares a folder and the recipient sees only that
   subtree." Journeys come from here.
3. **Invariants** from `docs/ARCHITECTURE.md` and the module TODOs. These are
   already written; this project turns them into assertions.
4. **Contracts** from `packages/shared`. Every request and response shape.

Explicitly *not* a driver: internal structure. No suite asserts that a private
method was called, and no suite mocks a class this repo owns in order to test
another class this repo owns.

---

## 4. The first run must be red

A TDD harness that reports "0 tests, all passing" on day one is lying — it has
no idea how much is missing. So the registry drives the report:

- [x] `src/registry/` parses every `## Declared tests` table into a registry.
      Only `###` groups **under a `## Declared tests` heading** are read, so a
      `## Personas` table like the one in `suites/journeys` is not a declaration
- [x] A **coverage gate** suite compares declarations against implementations
      and emits one failing test per declared ID with no implementation, titled
      with that ID
- [x] The gate runs as its own Vitest project, `gate`, because it lives in
      `src/` and every other project includes only `suites/**`. Without a
      project of its own it is never collected, and run #1 is green by accident
      — which is the exact failure this section exists to prevent
- [x] **Implementations are discovered by scanning spec files, not run output.**
      The gate greps test titles across all of `suites/**` — the four Vitest
      projects *and* the Playwright journeys. Reading Vitest results instead
      would leave all 39 `JOURNEY-*` declarations permanently unimplemented,
      since Vitest never collects them
- [x] The scanner strips comments first and matches string literals **one line
      at a time**. Both rules are load-bearing: an id mentioned only in a
      comment must not count as implemented, and pairing quotes across a whole
      file lets a single apostrophe in prose swallow every id after it. That
      second one shipped, cost four silently-unimplemented tests, and is now
      pinned by `src/registry/scan.spec.ts`
- [x] Rows marked `RETIRED` keep their number but leave the `declared` count.
      The row stays so the ID is never reused; the requirement is gone
- [x] Result: run #1 has ~0 green and **534 red** — one per live declaration.
      Progress is `implemented / declared` and `green / declared`, both real
      numbers rather than a percentage of whatever tests happen to exist
- [x] An implementation whose ID is not declared also fails the gate. Tests do
      not appear from nowhere
- [ ] The gate is the only place `it.todo` is acceptable. Everywhere else, an
      unfinished test fails
- [ ] **CI gates on `newly failing`, never on `green == declared`.** The suite
      is red by design until the last declaration lands, so a red build is the
      resting state and cannot be the merge signal. Until `pnpm history diff`
      exists (§5), CI runs `--project gate --project contract --project api-unit`
      and gates on those; `api-integration` needs a database and is opt-in

---

## 5. Viewing past runs — files, not a database

Runs are append-only files under `runs/`. No schema, no service, no migration,
and it survives `git clean` only if you commit `index.jsonl`, which is the point.

```
runs/
├── index.jsonl              one line per run — the history
├── 2026-08-16T14-22-05Z-a1b2c3d.json   full result for that run
├── latest.json              always the most recent (vitest json reporter)
├── latest-e2e.json          most recent Playwright run
└── coverage/
```

### `index.jsonl` — one JSON object per line
```jsonc
{
  "runId": "2026-08-16T14-22-05Z-a1b2c3d",
  "startedAt": "2026-08-16T14:22:05.123Z",
  "durationMs": 48213,
  "git": { "sha": "a1b2c3d", "branch": "main", "dirty": false },
  "projects": ["contract", "api-unit", "api-integration", "web-unit"],
  "declared": 534,
  "implemented": 37,
  "totals": { "passed": 31, "failed": 6, "skipped": 0 },
  "failedIds": ["API-NODES-011", "API-ACCESS-004"]
}
```

### Responsibilities
- [ ] `src/reporters/run-log.reporter.ts` — a Vitest reporter that writes the
      timestamped per-run file and appends one line to `index.jsonl`
- [ ] Stamp the git sha and branch. A run you cannot tie to a commit is an
      anecdote
- [ ] Record `declared` and `implemented` alongside pass/fail, so history shows
      the suite growing, not just going green
- [ ] Adapt the Playwright JSON into the same index, so one history covers both
- [ ] `pnpm history` — table of recent runs
- [ ] `pnpm history <runId>` — one run in detail
- [ ] `pnpm history diff <a> <b>` — newly failing, newly passing, newly declared.
      **Newly failing is the number that matters**; a total that went from 40 to
      41 green can still hide a regression
- [ ] Retain the last 100 runs; prune older per-run files but never prune
      `index.jsonl`
- [ ] Never write anything to `runs/` that contains a token, a password, a
      presigned URL, or a `SEED_USERS` value. Failure output is committed

### Interim, before the reporter exists
`vitest.config.ts` already writes `runs/latest.json` with the built-in json
reporter, and Playwright writes `runs/latest-e2e.json`. That gives a file-based
result immediately; it just has no history until the reporter above lands.

---

## 6. Harness — `src/support/`

Needed before the first integration test, and not before.

- [ ] `global-setup.ts` — start Postgres, run `prisma migrate deploy`, seed a
      known fixture set, expose the URL. Prefer a disposable database per run
      over cleaning between tests
- [ ] **Postgres comes from `docker-compose`**, not `testcontainers` and not a
      Neon branch. One `docker-compose.test.yml` with a pinned `postgres:18`
      image, started by `global-setup` if it is not already up. `testcontainers`
      is a dependency and a Docker-API integration for something a compose file
      does in six lines; a Neon branch needs credentials in CI and network on
      every run. The compose file also doubles as the local dev database
- [ ] `app.ts` — boot the Nest app once per file via `Test.createTestingModule`,
      with `STORAGE` bound to the in-memory adapter from `storage/TODO.md`
- [ ] `factories.ts` — `makeRoom`, `makeFolder`, `makeFile`, `makeUser`,
      `makeShare`. Every factory takes overrides and returns realistic defaults,
      including non-ASCII names by default so Unicode bugs surface in ordinary
      tests rather than in one dedicated test
- [ ] `actors.ts` — `asOwner`, `asInvitedViewer`, `asPublicToken`, `asStranger`,
      `asAnonymous`. The permission matrix is built from these, so they are
      defined once
- [ ] `web-setup.ts` — testing-library matchers and cleanup
- [ ] No `beforeEach` that reaches into the database directly. Tests arrange
      through factories or through the API, never through raw SQL — a test that
      writes an impossible row proves nothing about the system

---

## 7. Order of work

Matching the build order in the root README, because a suite is only useful
once its module exists to fail against.

1. **`src/registry/` and the coverage gate.** Without it, run #1 is not red and
   the whole approach is decorative
2. `suites/contract/` — no dependencies, catches schema drift immediately
3. `suites/api/common`, then `nodes` — the property test is the highest-value
   test in the repo and is specified to be written *before* folder CRUD exists.
   State it against `parent_id`, not against a `path` column: the module
   publishes an ancestor list and keeps its storage private, so the test
   recomputes the truth rather than reading back the same derived value
4. `suites/api/access` — the permission matrix, pure and fast
5. `suites/api/auth`, `sharing`, `links`, `files`. `links` can follow `access`
   immediately, since its whole surface is one route over `SharesRepository` —
   and its indistinguishability group is worth green before anything is
   deployed anywhere reachable
6. `src/reporters/` and `src/history/` — once there is enough history to read
7. `suites/web/*`
8. `suites/journeys/` — last, and deliberately few
9. `suites/api/jobs`, `search`

## Done when
`pnpm test` reports a real `implemented / declared` ratio, `pnpm history diff`
answers "what did this branch break", and every `P0` declaration in every suite
is green.
