# access — L2

## Purpose
Stores grants and answers one question: what role does this actor have on this
node? Every authorization decision in the system routes through here.

## Owns
`shares` table, and the definition of `Role`:

```ts
type Role = 'none' | 'viewer' | 'editor' | 'owner';   // ordered, ascending
```

`@RequireAccess(verb)` maps to a minimum role:

| Verb | Satisfied by |
| --- | --- |
| `read` | `viewer`, `editor`, `owner` |
| `write` | `editor`, `owner` |
| `own` | `owner` |

`max(role)` is the ordinal maximum over that ordering, which is why the union is
declared in ascending order rather than alphabetically. `editor` is defined and
**never issued** — see the invariant below.

## Public surface
- `resolveAccess(input): Role` — **pure function, zero dependencies**
- `NodeAccessGuard`, `@RequireAccess('read' | 'write' | 'own')`
- `SharesRepository` — grant reads and writes
- `ShareCodec` — `mintToken()`, `mintShortCode()`, `hash(value)`, `findByCredential()`.
  Lives here because `sharing` issues credentials and `links` reads them, and
  both must import downward. The format is specified in
  [`links/TODO.md`](../links/TODO.md)
- `NODE_LOOKUP` port + `NodeSnapshot` type (see `docs/ARCHITECTURE.md`)

## Depends on
`common`, and `NODE_LOOKUP` — which it declares and does not implement. It
never imports `nodes`.

## Must not depend on
`nodes`, `sharing`, `files`. `sharing` sits above this module, not beside it.

## Responsibilities
- [x] Schema: `id`, `node_id`, `kind` (`public_link` | `user`), `token_hash`,
      `short_code_hash` (nullable, unique), `principal_user_id`,
      `principal_email`, `role`, `expires_at`, `revoked_at`, `created_by`,
      `created_at`
- [x] `short_code_hash` is the second spelling of the same grant, minted only
      when a share is created with `shortLink: true`. It is a column rather than
      a table for one reason: revocation must not have two places to reach. See
      [`links/TODO.md`](../links/TODO.md). Lookups by either hash are indexed;
      neither is ever scanned
- [x] The resolver, as a pure function:
      ```ts
      resolveAccess({ actor, node: NodeSnapshot, grants: Grant[] }): Role
      ```
      Ancestor ids arrive on `node.ancestorIds`, already resolved by the
      repository behind `NODE_LOOKUP` — no recursion and no extra query here.
      This module never learns how `nodes` computes them, which is why a change
      of storage strategy cannot reach the resolver.
- [x] `NodeSnapshot.ancestorsDeleted` is what makes the deleted-ancestor rule
      below computable. The old five-field snapshot carried only the node's own
      `deletedAt`, so a pure function had no way to see a deleted ancestor and
      the invariant was unenforceable as written. `NodesRepository` computes the
      flag in the query it already runs
- [x] `NodeAccessGuard`: load snapshot → load grants for `ancestorIds + self` in
      one query → resolve → attach `req.access` → **404 on denial**
- [x] Effective role is `max(role)` across self and all ancestors

## Invariants
- Denial is 404, never 403.
- Resolution returns `none` if the target or **any ancestor** has
  `deleted_at != null`. This is the second line of defence behind atomic
  cascade delete; if the cascade ever became async, this is what stops a stale
  grant resolving.
- Expired and revoked grants are excluded in the SQL, not filtered in JS. So
  `resolveAccess` never evaluates `expires_at`: by the time a grant reaches it,
  expiry has already been applied. `API-ACCESS-007` therefore asserts the query,
  not the resolver — which is why it is declared against the repository rather
  than as a pure-function case, and why it needs no clock stub.
- `role` is an enum with `editor` already defined and never issued. Adding
  per-user roles later is a data change, not a schema change — this is the
  answer to the README's third scaling question, and it should be visibly true
  in the code.

## Implementation notes

- [x] **The `NODE_LOOKUP` binding cannot live in `AppModule`'s `providers`**, and
      the architecture document's one-liner does not work. Nest resolves a
      provider's dependencies in **its own** module's injector, not its parent's,
      so `NodeAccessGuard` — declared here — cannot see a token provided one level
      up. It fails at boot with "make sure that Symbol(NODE_LOOKUP) is available
      in the AccessModule module".

      The fix is a small `@Global()` module in the composition root
      (`NodeLookupBindingModule`). Both alternatives are worse: providing it in
      this module needs `NodesRepository`, so `access` would import `nodes` and
      the cycle is back; providing it in `NodesModule` needs the token, so L1
      would import L2. Global also means every L3 module using
      `@UseGuards(NodeAccessGuard)` gets it without repeating the binding.
- [x] **The resolver scopes a share credential to the grant it names**, not to
      "any live grant on this chain". With two links in one room the weaker check
      is satisfied by either token — `API-ACCESS-015`.
- [x] **A pending email grant resolves for nobody.** `principal_user_id` is null
      until that person logs in, and a resolver that ignored the null would hand
      the folder to every signed-in user — `API-ACCESS-016`.
- [x] `owner` comes from `nodes.owner_id` and never from a grant; the database
      refuses to store a `none` or `owner` role at all, so there is exactly one
      path to ownership.
- [x] Credentials are hashed with **SHA-256, not argon2**. A password is
      low-entropy and human-chosen, so it needs a slow hash; these are 256 and 80
      bits of CSPRNG output with nothing to brute-force, and this hash sits on
      every request a share visitor makes.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/access/TODO.md`](../../../../tests/suites/api/access/TODO.md) and implemented there — never in this module's folder.
- [x] **Permission matrix**: owner / invited viewer / public token / stranger ×
      room / folder / file × read / write. Table-driven, pure, ~24 cases, runs
      in milliseconds. Cite this file in the README.
- [x] Inheritance: a grant on a grandparent resolves on a grandchild
- [x] A grant on a deleted ancestor resolves to `none`
- [x] An expired grant resolves to `none` without a clock stub hack
- [x] `max(role)` wins when two grants on the ancestor chain differ

## Done when
The matrix is green and no other module in the codebase reads the `shares`
table directly.
