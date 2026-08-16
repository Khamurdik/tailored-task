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
      service. `prisma db seed` runs `node prisma/seed.ts` directly, and Node's
      native type stripping erases types but **cannot parse decorators**; an
      import that reaches a Nest service dies with
      `SyntaxError: Invalid or unexpected token` at the `@`. The `AuthService`
      can then wrap the same helper for DI. Verified on Node 26.7.0
- [ ] **Idempotent upsert by email.** Re-running the seed must be safe
- [ ] Never overwrite an existing `password_hash` unless `SEED_FORCE_RESET=true`.
      A re-run after a password change must not silently reset it
- [ ] Emit `user.created` per newly inserted row
- [ ] Log one line per user with the email and whether it was created, updated,
      or skipped. Never log the password or the hash

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

## Done when
`pnpm db:migrate` on an empty database yields exactly the users listed in
`.env`, each able to log in with the password from `.env`, and running it again
changes nothing.
