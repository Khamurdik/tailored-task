# api/users

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/users/TODO.md`](../../../../apps/api/src/users/TODO.md)

Provisioning is the whole story here. There is no registration, so the seeder is
the only path that creates a user and it deserves real coverage.

## Declared tests

### Lookup

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-USERS-001 | `findByEmail` matches across upper and lower case | unit | P1 |
| API-USERS-002 | `findByEmail` matches across NFC and NFD forms | unit | P1 |

### Seeding

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-USERS-003 | Seeding an empty database creates exactly the users in `SEED_USERS` | integration | P1 |
| API-USERS-004 | Seeding twice creates one row per user and rewrites nothing | integration | P1 |
| API-USERS-005 | A re-seed does not overwrite an existing `password_hash` | integration | P0 |
| API-USERS-006 | `SEED_FORCE_RESET=true` does overwrite it | integration | P1 |
| API-USERS-007 | A seeded user's hash verifies against `auth`'s comparison function | integration | P0 |

### Admin, secrecy, and events

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-USERS-008 | A user seeded without `admin` gets `is_admin = false` | security | P1 |
| API-USERS-009 | A re-seed never promotes an existing user to admin | security | P1 |
| API-USERS-010 | Malformed `SEED_USERS` aborts the seed with a readable error and inserts nothing | integration | P1 |
| API-USERS-011 | Seeder output contains no password and no hash | security | P1 |
| API-USERS-012 | `user.created` is emitted once per newly inserted row and not on re-seed | integration | P1 |
| API-USERS-013 | `google_sub` is unique — two users cannot claim one Google identity | integration | P1 |
| API-USERS-014 | No HTTP route in the application creates a user row | security | P0 |
| API-USERS-015 | `node prisma/seed.ts` runs to completion under Node's type stripping on the pinned version | integration | P0 |
| API-USERS-016 | No module in the strip-safe zone uses a decorator, an enum, a parameter property, or an extensionless relative import | unit | P1 |

## Notes
- API-USERS-015 and API-USERS-016 pair the way 011/012 do in `jobs`: 015 catches
  the breakage, 016 says which of the four rules was broken. 016 is a static
  scan over the transitive imports of `prisma/seed.ts`, not a runtime test — and
  it is cheap enough to be worth having, because 015's failure output is a bare
  `SyntaxError` with no indication of which rule was violated.
- **API-USERS-007 is the one that catches the expensive bug.** If the seeder and
  `auth` drift on argon2 parameters, every seeded user simply cannot log in, and
  the symptom is indistinguishable from a wrong password. Assert the round trip,
  not the parameters.
- API-USERS-014 is best written as a route-table scan asserting no handler calls
  the user-creating repository method, rather than by enumerating endpoints by
  hand — the hand-written version rots the moment someone adds a controller.
