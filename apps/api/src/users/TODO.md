# users — L1

## Purpose
User records and lookup. The identity store, with no opinion about how
identity is proven.

## Owns
`users` table, and the provisioning path that fills it.

## Public surface
- `UsersService`: `findById`, `findByEmail`, `findByGoogleSub`, `linkGoogleSub`
- `UsersRepository`
- `User` domain type

Note there is no public `create`. Provisioning happens through the seeder
below, not through a request.

## Depends on
`common`.

## Must not depend on
`auth` (auth depends on this, not the reverse), `nodes`, `access`.

## Responsibilities
- [ ] Schema: `id`, `email` (citext, unique), `password_hash` (nullable),
      `name`, `google_sub` (nullable, unique), `is_admin` (boolean, default
      false), `created_at`
- [ ] `is_admin` gates the `jobs` endpoints and nothing else today. It is set
      only by the seeder — there is no endpoint that grants it, and no way for a
      user to escalate into it
- [ ] Case-insensitive email lookup — use `citext`, not `lower()` at every call site
- [ ] `linkGoogleSub(userId, sub)` — called by `auth` on first Google login
- [ ] Emit `user.created` from the seeder so `sharing` can bind pending
      email-addressed grants without this module knowing shares exist

## Provisioning — how users get created

There is no registration endpoint. Accounts are created out of band, from
`.env`, as part of the migration workflow.

### Why this is a seed script and not a SQL migration

A plain SQL migration cannot do this job, for two independent reasons:

1. **Prisma migrations are static, checksummed SQL.** They have no access to
   `process.env`, so `.env`-driven values cannot reach them. Editing a migration
   to inject values breaks its checksum.
2. **Postgres cannot compute an argon2id hash.** `pgcrypto`'s `crypt()` offers
   bcrypt and (on PG 18) sha256/512-crypt — never argon2. Third-party extensions
   exist (`pg_pwhash`, `pg_argon2id`) but a managed host like Neon will not
   install them.

So the hash has to be produced in Node. Prisma's seed step runs automatically
after `migrate dev` and `migrate reset`, which keeps it inside the migration
workflow where it was wanted.

### This is a local workflow only — say so, and write the production runbook

`prisma db seed` runs as part of `migrate dev` and `migrate reset`. **Both are
development commands.** Production deploys run `prisma migrate deploy`
(`pnpm db:deploy`), which does *not* run the seed. Left implicit, that means a
deployed environment has no users at all — and since `is_admin` is only ever set
by the seeder, no way to reach `/jobs` either.

Local is the supported path and that is fine. What is not fine is leaving the
production case undocumented, so:

- [ ] `pnpm db:seed` (`prisma db seed`) is a standalone command and works
      against any `DATABASE_URL`. Production provisioning is running it
      deliberately, once, against the production database — not a side effect
      of deploying
- [ ] Write the runbook into the README as literal commands:
      ```bash
      # after `pnpm db:deploy` has applied migrations
      DATABASE_URL="<prod url>" SEED_USERS='[…]' pnpm --filter @dataroom/api db:seed
      ```
- [ ] State the two failure modes it prevents: a deploy that leaves nobody able
      to log in, and an operator who reaches for `migrate reset` in production
      to "run the seed" and drops the database
- [ ] `SEED_FORCE_RESET` must be false in that invocation unless the intent is
      specifically a password reset. Say so in the runbook, next to the command
- [ ] The seed is idempotent (below), so re-running it after a deploy is safe
      and is the intended way to add a user to a running environment

### Responsibilities
- [ ] `prisma/seed.ts`, wired via `"prisma": { "seed": "..." }` in
      `apps/api/package.json`
- [ ] Read `SEED_USERS` from the environment and validate it with the same zod
      config schema `common` uses — a malformed seed fails loudly at boot, not
      halfway through the insert
- [ ] Format: a JSON array, so names and passwords containing `:` or `,` are not
      a parsing problem
      ```
      SEED_USERS='[{"email":"ana@corp.com","password":"…","name":"Ana","admin":true}]'
      ```
      `admin` is optional and defaults to false
- [ ] Hash each password with the **same** argon2id parameters `auth` uses.
      Import the helper rather than re-declaring the parameters — divergence
      here means seeded users cannot log in, and the failure looks like a wrong
      password
- [ ] **The helper must be a plain, decorator-free module** — put it in
      `auth/password.ts` as exported functions, not on an `@Injectable()`
      service. The `AuthService` can then wrap the same helper for DI.
      See the strip-safe zone below for why, and for the three other rules that
      come with it
- [ ] **Idempotent upsert by email.** Re-running the seed must be safe
- [ ] Never overwrite an existing `password_hash` unless `SEED_FORCE_RESET=true`.
      A re-run after a password change must not silently reset it
- [ ] Emit `user.created` per newly inserted row
- [ ] Log one line per user with the email and whether it was created, updated,
      or skipped. Never log the password or the hash

### The strip-safe zone — what `prisma/seed.ts` may import

`prisma db seed` runs `node prisma/seed.ts`. Node 26 executes that file under
**type stripping**: it erases type annotations and runs the result, with no
compiler. Four things fail there, and the whole transitive import graph of
`seed.ts` is subject to all four. Verified by execution on Node 26.7.0:

| In the import graph | Result |
| --- | --- |
| A decorator (`@Injectable()`) | `SyntaxError: Invalid or unexpected token` at the `@` |
| A parameter property (`constructor(private readonly x: T)`) | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript parameter property` |
| An `enum` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX: TypeScript enum` |
| A relative import with no file extension | `ERR_MODULE_NOT_FOUND` |

The last two are the ones an earlier revision of this file missed, and the last
one is the one that bites hardest: `apps/api` compiles under
`moduleResolution: node10`, so **every import in `src/` is extensionless** —
which is exactly what Node's ESM resolver rejects. Writing `.ts` into the
specifier is not a fix for `src/`, because `allowImportingTsExtensions` requires
`noEmit` and this package emits.

The parameter-property rule also widens the constraint well past "no decorators":
constructor injection is *the* NestJS idiom, so almost any service reached from
the seed fails even without a decorator on it.

So the rule is a small, explicitly-listed set of leaf modules:

- [ ] **`auth/password.ts`** — argon2id hash/verify. No decorators, no enums, no
      parameter properties, and **no relative imports at all**. Bare specifiers
      (`@node-rs/argon2`) resolve normally and are fine
- [ ] **`common/config/seed-users.schema.ts`** — the zod schema for
      `SEED_USERS`, under the same rules. It must be a leaf: importing it from
      `common`'s Nest config module is fine, but it may not import back into it.
      An earlier revision said the seeder should reuse "the same zod config
      schema `common` uses" without noticing that `common`'s config *module* is
      a Nest provider and would take the seed down with it
- [ ] `prisma/seed.ts` imports those two with **explicit `.ts` extensions**, and
      is the only file in the package that does. It is excluded from
      `tsconfig.json` and typechecked by `tsconfig.seed.json`, which sets
      `allowImportingTsExtensions` + `noEmit` so `nest build` never sees it
- [ ] Anything else the seeder needs is a bare specifier (`@prisma/client`) or
      gets copied into the zone. Do not widen it casually — every module added
      here is a module that can never use constructor injection
- [ ] Fallback if the zone becomes unmaintainable: point the seed at built
      output (`"seed": "node dist/prisma/seed.js"`) and require `pnpm build`
      before `db:migrate`. That sidesteps type stripping entirely, at the cost
      of a stale-`dist` footgun in the dev loop. Not chosen; recorded so the
      option is not rediscovered under pressure

### Manual `INSERT INTO` is supported, with one caveat
An operator inserting a row by hand is a legitimate path, but raw SQL emits no
`user.created` event, so pending share grants for that email would never bind.
This is why `sharing` also binds pending grants at login time — see
`sharing/TODO.md`. The event is a fast path; login is the guarantee.

## Invariants
- Email comparison is case-insensitive and NFC-normalized everywhere.
- This module never sees a plaintext password. Hashing lives in `auth`, and the
  seeder calls into it.
- `password_hash` is nullable: a user provisioned for Google-only access has no
  password. `auth` must treat null as "no password login", not as "any password
  matches".
- `google_sub` is unique. Two users cannot claim one Google identity.
- No HTTP request in the system creates a user row.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/users/TODO.md`](../../../../tests/suites/api/users/TODO.md) and implemented there — never in this module's folder.
- [ ] `findByEmail` matches across case and Unicode normalization forms
- [ ] Seeding twice creates one row and does not rewrite the hash
- [ ] `SEED_FORCE_RESET=true` does rewrite it
- [ ] A seeded user's hash verifies against `auth`'s comparison function —
      this is the test that catches parameter drift
- [ ] A malformed `SEED_USERS` fails the run with a readable error
- [ ] A user seeded without `admin` gets `is_admin = false`, and re-seeding
      never silently promotes an existing user
- [ ] `node prisma/seed.ts` runs to completion on the pinned Node version —
      this is the test that catches someone adding an `@Injectable()`, an
      `enum`, or an extensionless import anywhere in the strip-safe zone

## Done when
`pnpm db:migrate` on an empty database yields exactly the users listed in
`.env`, each able to log in with the password from `.env`, and running it again
changes nothing.
