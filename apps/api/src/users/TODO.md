# users — L1

## Purpose
User records and lookup. The identity store, with no opinion about how
identity is proven.

## Owns
`users` table.

## Public surface
- `UsersService`: `findById`, `findByEmail`, `create`
- `UsersRepository`
- `User` domain type

## Depends on
`common`.

## Must not depend on
`auth` (auth depends on this, not the reverse), `nodes`, `access`.

## Responsibilities
- [ ] Schema: `id`, `email` (citext, unique), `password_hash`, `name`,
      `created_at`
- [ ] Case-insensitive email lookup — use `citext`, not `lower()` at every call site
- [ ] `create` emits `user.registered` so `sharing` can claim pending
      email-addressed grants without this module knowing shares exist

## Invariants
- Email comparison is case-insensitive and NFC-normalized everywhere.
- This module never sees a plaintext password. Hashing lives in `auth`.

## Tests
- [ ] `findByEmail` matches across case and Unicode normalization forms

## Done when
A user can be created and looked up, and registering emits the event.
