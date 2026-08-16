# access — L2

## Purpose
Stores grants and answers one question: what role does this actor have on this
node? Every authorization decision in the system routes through here.

## Owns
`shares` table, and the definition of `Role`.

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
- [ ] `NodeAccessGuard`: load snapshot → load grants for `ancestorIds + self` in
      one query → resolve → attach `req.access` → **404 on denial**
- [ ] Effective role is `max(role)` across self and all ancestors

## Invariants
- Denial is 404, never 403.
- Resolution returns `none` if the target or **any ancestor** has
  `deleted_at != null`. This is the second line of defence behind atomic
  cascade delete; if the cascade ever became async, this is what stops a stale
  grant resolving.
- Expired and revoked grants are excluded in the SQL, not filtered in JS.
- `role` is an enum with `editor` already defined and never issued. Adding
  per-user roles later is a data change, not a schema change — this is the
  answer to the README's third scaling question, and it should be visibly true
  in the code.

## Tests
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
