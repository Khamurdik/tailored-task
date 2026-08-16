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
- `NODE_LOOKUP` port + `NodeSnapshot` type (see `docs/ARCHITECTURE.md`)

## Depends on
`common`, and `NODE_LOOKUP` — which it declares and does not implement. It
never imports `nodes`.

## Must not depend on
`nodes`, `sharing`, `files`. `sharing` sits above this module, not beside it.

## Responsibilities
- [ ] Schema: `id`, `node_id`, `kind` (`public_link` | `user`), `token_hash`,
      `principal_user_id`, `principal_email`, `role`, `expires_at`,
      `revoked_at`, `created_by`, `created_at`
- [ ] The resolver, as a pure function:
      ```ts
      resolveAccess({ actor, node: NodeSnapshot, grants: Grant[] }): Role
      ```
      Ancestor ids come from `node.path` — no recursion, no extra query.
- [ ] `NodeSnapshot.ancestorsDeleted` is what makes the deleted-ancestor rule
      below computable. The old five-field snapshot carried only the node's own
      `deletedAt`, so a pure function had no way to see a deleted ancestor and
      the invariant was unenforceable as written. `NodesRepository` computes the
      flag in the query it already runs
- [ ] `NodeAccessGuard`: load snapshot → load grants for `ancestorIds + self` in
      one query → resolve → attach `req.access` → **404 on denial**
- [ ] Effective role is `max(role)` across self and all ancestors

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

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/access/TODO.md`](../../../../tests/suites/api/access/TODO.md) and implemented there — never in this module's folder.
- [ ] **Permission matrix**: owner / invited viewer / public token / stranger ×
      room / folder / file × read / write. Table-driven, pure, ~24 cases, runs
      in milliseconds. Cite this file in the README.
- [ ] Inheritance: a grant on a grandparent resolves on a grandchild
- [ ] A grant on a deleted ancestor resolves to `none`
- [ ] An expired grant resolves to `none` without a clock stub hack
- [ ] `max(role)` wins when two grants on the ancestor chain differ

## Done when
The matrix is green and no other module in the codebase reads the `shares`
table directly.
