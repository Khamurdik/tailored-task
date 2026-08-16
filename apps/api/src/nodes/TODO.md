# nodes — L1

## Purpose
The tree. Rooms, folders, and files are one table; this module is the sole
writer of it and the only place that understands paths.

## Owns
The tree: node identity, ancestry, naming, and the invariants that keep them
consistent. Also the **storage strategy** for ancestry, which is this module's
private business and nobody else's.

## Public surface
- `NodesService` — create room, create folder, rename, move, soft-delete, list children
- `NodesRepository` — also satisfies `access`'s `NodeLookupPort`
- `NodeAncestryService` — `ancestorsOf`, `assertNoCycle`, `assertDepth`, `rebuildSubtree`
- `NodeNamingService` — conflict detection and resolution
- `NodeStatsService` — subtree counts and bytes

## Depends on
`common`.

## The contract — what the rest of the system may assume

This is the abstraction other modules compile against. It is complete, and it
is deliberately free of any column name, so work above L1 can proceed before the
physical schema is settled.

```ts
type NodeType = 'room' | 'folder' | 'file';
type NodeState = 'pending' | 'active';   // `files` owns the transition

interface Node {
  id: string;                 // UUID, assigned here, never by a caller
  type: NodeType;
  rootId: string;             // the room this belongs to; a room is its own root
  parentId: string | null;    // null only for a room — the source of truth
  ownerId: string;
  name: string;               // NFC-normalized, sanitized, unique among live siblings
  depth: number;              // ancestor count; 0 for a room
  state: NodeState;
  sizeBytes: number | null;   // files only; authoritative value comes from S3
  contentType: string | null; // files only
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface Ancestry {
  ancestorIds: readonly string[];  // root first, excluding self
  ancestorsDeleted: boolean;       // any ancestor soft-deleted
}
```

Three rules make this an abstraction rather than a description:

- **Ancestry is a list, never a string.** `ancestorIds` is what `access`
  resolves grants over and what breadcrumbs render from. A delimited `path` is
  one way to compute that list quickly; it is not the list.
- **Every subtree operation is a method, never a query someone else writes.**
  `deleteSubtree`, `moveSubtree`, `statsFor`, `listChildren` are the surface. No
  module outside `nodes` writes a prefix predicate, a recursive CTE, or a join
  against a closure table, because doing so hard-codes the strategy at a call
  site the strategy cannot see.
- **Ordering is part of the contract.** Children come back folders-before-files
  then by name, and the keyset cursor is opaque and issued by this module. A
  caller that reconstructs a cursor has taken a dependency on the collation.

## Storage — deferred on purpose

The physical schema and its indexes are **not specified yet, and are not
blocking**. Everything above L1 depends on the contract, not the table.

What is already decided: it is one **self-referencing table** with `parent_id`
referencing the same table, discriminated by `type`. What is open is how
ancestry is made queryable.

| Strategy | Cost of the read | Cost of the write |
| --- | --- | --- |
| Materialized `path` of ancestor ids | one prefix predicate | every move rewrites a subtree |
| Recursive CTE from `parent_id` | one CTE per query, no derived state | moves are a single row update |
| Closure table | one indexed join | a second table to keep honest |

**The expected choice is the materialized path** — the whole system is
prefix-shaped (cascade delete, subtree stats, share scoping), and it is what the
notes throughout this repo already price. Two things must land in the same
change that picks it, and neither is obvious enough to rediscover:

- prefix `LIKE` only uses an index under `text_pattern_ops` or `C` collation;
- the keyset cursor's collation must match the `ORDER BY` collation exactly.

Until then, write `NodeAncestryService` against the contract and let the
repository be the only file that knows the answer. If the strategy is ever
swapped, the blast radius is this module — which is the point of doing it this
way rather than putting `path` in a shared type.

## Must not depend on
`storage` (a file row does not know what a bucket is), `access` (authorization
is decided before this module is called), `auth`.

## Responsibilities
- [ ] The `Node` and `Ancestry` contract above, as types the module exports
- [ ] Physical schema and indexes — **deferred**, see §Storage. Pick the
      strategy, then write the DDL and the index list in the same change
- [ ] `NodeAncestryService` — stated against the contract, so every item here
      survives a change of strategy
  - [ ] `ancestorsOf(id)` → `Ancestry`, root first, excluding self, with
        `ancestorsDeleted` computed in the same read
  - [ ] `assertNoCycle(source, target)`: reject when `target` is `source` or any
        descendant of it
  - [ ] `assertDepth`: reject `targetDepth + subtreeHeight > MAX_DEPTH`
  - [ ] `moveSubtree` — one statement, holding a row lock on the moved node
        taken **before** its ancestry is read. Under the materialized path that
        is `UPDATE … SET path = replace(path, $old, $new), depth = depth + $delta
        WHERE path LIKE $old || '%'` with a `SELECT … FOR UPDATE` ahead of it
  - [ ] `deleteSubtree`, `statsFor` — same rule: a method here, never a
        predicate written by a caller
  - [ ] `rebuildSubtree` — regenerates all derived ancestry from `parent_id`,
        exposed as a CLI command. This is the escape hatch if a migration
        corrupts state, and it is only writable because `parent_id` is the
        source of truth
- [ ] `NodeNamingService`
  - [ ] Normalize → sanitize → check → resolve
  - [ ] Retry loop on `23505`, recomputing the suffix, capped at 10 attempts
- [ ] `NodesService`
  - [ ] Cascade soft-delete over the whole subtree, in one transaction, emitting
        `node.deleted` with the subtree id list. **`sharing` owns the listener**
        — this module only emits. (`access` is storage and resolution; the
        use-case that revokes grants sits above it.)
        Known limitation: the id list is unbounded, so deleting a large room
        puts every descendant id in one payload. Accepted for now; the fix when
        it hurts is to name the subtree by its root id and let the listener ask
        this module for the members
  - [ ] Listing: keyset paginated, folders before files,
        `ORDER BY type, name COLLATE "C", id`
  - [ ] Breadcrumbs come from `ancestorsOf` in the same response — one read,
        never a second round trip per crumb
- [ ] `NodeStatsService`
  - [ ] Live subtree aggregate for delete confirmation
  - [ ] Denormalized `subtree_files` / `subtree_bytes` maintained by trigger for
        anything rendered in a list

## Invariants
Invariants 1–6 in `docs/ARCHITECTURE.md` are this module's responsibility.
Invariant 6 is the one nobody outside this module may rely on — it is a
property of the storage strategy, and it is listed there under its own heading
for that reason.

Additionally, once the materialized path is chosen: the cursor's collation must
match the `ORDER BY` collation exactly. A mismatch silently skips or duplicates
rows at page boundaries, and it only manifests with non-ASCII names.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/nodes/TODO.md`](../../../../tests/suites/api/nodes/TODO.md) and implemented there — never in this module's folder.
- [ ] **Property test**: 200 random ops (create / move / rename / delete), then
      assert — **against `parent_id` alone, walked in the test** — that every
      node's reported `ancestorIds` equals that walk, `depth` equals its length,
      no cycles exist, and no live node sits under a deleted parent. This is the
      highest-value test in the repo — write it before folder CRUD exists.
      Stating it against `parent_id` rather than against a `path` column is what
      makes it writable now and what keeps it honest afterwards: the test
      recomputes the truth instead of reading the same derived value the code
      would have to get wrong in exactly the same way to pass.
- [ ] Move into own descendant rejected; move to self rejected
- [ ] Depth cap rejected with 400, not a Postgres error
- [ ] Cascade delete leaves nothing half-done after a forced rollback
- [ ] Concurrent same-name creation: 10 parallel requests → 10 distinct names, no 500s
- [ ] Subtree stats match a naive recursive walk
- [ ] Pagination over 500 children with Cyrillic and accented names loses nothing

## Done when
The property test passes and a 5-level tree can be created, moved, listed, and
cascade-deleted with paths intact throughout.
