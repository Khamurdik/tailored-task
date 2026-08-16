# api/nodes

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/nodes/TODO.md`](../../../../apps/api/src/nodes/TODO.md) ·
invariants 1–6 in [`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md)

The highest-value suite in the repository. `path` is derived state, and every
invariant here exists to keep it honest.

**Write API-NODES-001 before folder CRUD exists.** It is specified that way in
the module TODO for a reason: a property test written after the fact tends to
encode the bugs.

## Declared tests

### Tree properties

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-001 | After 200 random create/move/rename/delete ops, every path equals its ancestor chain | property | P0 |
| API-NODES-002 | After the same 200 ops, `depth == path segments - 1` for every node | property | P1 |
| API-NODES-003 | After the same 200 ops, no cycle exists | property | P0 |
| API-NODES-004 | After the same 200 ops, no live node sits under a deleted parent | property | P0 |

### Illegal moves and limits

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-005 | Moving a node into its own descendant is rejected | unit | P0 |
| API-NODES-006 | Moving a node onto itself is rejected | unit | P1 |
| API-NODES-007 | Exceeding `MAX_DEPTH` returns 400, not a raw Postgres index error | integration | P1 |

### Move and cascade

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-008 | Moving a subtree rewrites the paths of every descendant | integration | P1 |
| API-NODES-009 | Cascade soft-delete marks the whole subtree in one transaction | integration | P1 |
| API-NODES-010 | A forced rollback mid-cascade leaves nothing half-deleted | integration | P0 |

### Naming and injection safety

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-011 | Ten parallel creates of the same name yield ten distinct names and no 500 | integration | P0 |
| API-NODES-012 | Names are NFC-normalized before the uniqueness check | integration | P1 |
| API-NODES-013 | A name containing `%` or `_` cannot break a prefix query | security | P1 |
| API-NODES-014 | Nothing user-controlled ever appears in the `path` column | security | P0 |

### Listing and pagination

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-015 | Listing returns folders before files, then by name, then by id | integration | P1 |
| API-NODES-016 | Pagination over 500 children with Cyrillic and accented names loses and duplicates nothing | integration | P0 |
| API-NODES-017 | Cursor collation matches the `ORDER BY` collation exactly | integration | P1 |
| API-NODES-018 | Breadcrumbs arrive in the listing response without a second query | integration | P1 |

### Stats, rebuild, concurrency

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-NODES-019 | Subtree stats match a naive recursive walk | property | P1 |
| API-NODES-020 | `rebuildSubtree` reconstructs identical paths from `parent_id` alone | integration | P1 |
| API-NODES-021 | A concurrent move during a read does not observe a half-rewritten path | integration | P1 |

## Notes
- API-NODES-001..004 are one `fast-check` model: keep a simple in-memory tree as
  the model, apply the same ops to both, compare. Four declarations because four
  properties can fail independently and the failure messages should say which.
- API-NODES-016/017 must use non-ASCII fixtures. A collation mismatch is
  invisible with ASCII names, which is exactly why it ships.
- API-NODES-020 is the disaster-recovery path. It is worth testing precisely
  because it is the thing you reach for when something else has already gone
  wrong.
