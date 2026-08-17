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
- `NodeNamingService` — conflict detection and resolution
- Ancestry, depth, cycle and stats operations are methods on `NodesService` and
  `NodesRepository` rather than two further services. Splitting them out was
  specified and did not survive contact: `ancestorsOf`, `assertDepth` and
  `statsFor` each need the repository and nothing else, so a service in between
  would have been a pass-through. The path *format* did earn its own file —
  `node-path.ts`, pure string functions, no database and no Nest.

## Depends on
`common`.

## The contract — what the rest of the system may assume

This is the abstraction other modules compile against. It is deliberately free
of any column name — which is why choosing the storage strategy afterwards
required no change to it, and why the two files that mention `path` are the only
ones a future change would touch.

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

## Storage — decided: materialized path

**Chosen 2026-08-17.** `path` is `/id/id/id`, ancestors first, ending in self.
The comparison that led here is kept below.

Six indexes, not five, and the two that are easy to leave out are the two that
matter most:

| | Why |
| --- | --- |
| `(parent_id, name)` UNIQUE **WHERE deleted_at IS NULL** | Partial, so a soft-deleted node frees its name immediately rather than blocking re-upload for thirty days |
| `(owner_id, name)` UNIQUE **WHERE parent_id IS NULL AND deleted_at IS NULL** | A room's `parent_id` is NULL and Postgres treats NULLs as distinct, so the index above does not constrain rooms *at all* |
| `(path text_pattern_ops)` | **Mandatory, not an optimisation.** Under any collation but C, btree ordering does not match `LIKE 'prefix%'` and the planner scans. Every cascade in the system is this query |
| `(parent_id, type, name COLLATE "C", id)` WHERE live | Matches the listing's `ORDER BY` exactly. A collation mismatch between index and cursor silently skips or duplicates rows at page boundaries, only with non-ASCII names |
| `(created_at)` WHERE state = 'pending' | The reaper's query |
| `(deleted_at)` WHERE deleted_at IS NOT NULL | The hard-delete job's query |

Seven CHECK constraints back it up, so an application bug cannot write a tree
that is impossible to interpret: depth in `[0, 32]`, only a room has no parent, a
room is its own root and is depth 0, only files carry bytes, only files may be
`pending`, and `path` ends in the row's own id.

### The comparison that led here

Kept because the reasoning is the useful part, not the conclusion. The table is
one **self-referencing** relation with `parent_id` pointing at itself; the
question was only how ancestry is made queryable.

| Strategy | Cost of the read | Cost of the write |
| --- | --- | --- |
| Materialized `path` of ancestor ids | one prefix predicate | every move rewrites a subtree |
| Recursive CTE from `parent_id` | one CTE per query, no derived state | moves are a single row update |
| Closure table | one indexed join | a second table to keep honest |

The materialized path won because the whole system is prefix-shaped — cascade
delete, subtree stats and share scoping are all one predicate — and because the
notes throughout this repo already priced it.

**The contract did not change when the strategy was chosen**, which was the
point of publishing an ancestor list rather than a path string. `path` appears in
exactly two files: `node-path.ts`, which owns the format, and
`nodes.repository.ts`, which owns the queries. Nothing else in the codebase can
name it, so swapping the strategy stays inside this module.

## Implementation notes

- [x] **The name-conflict retry runs one transaction per attempt.** A constraint
      violation *aborts* a Postgres transaction, so a retry loop inside one
      transaction fails on the next statement with "current transaction is
      aborted" — including the read that would find a free name. The first
      version did that, and ten concurrent uploads of one name produced nine
      unknown-request errors instead of nine renames. `API-NODES-006` caught it.
      A `SAVEPOINT` per attempt would also work; Prisma does not expose one.
- [x] **`isUniqueViolation` has to recognise `P2010`.** A unique violation raised
      inside `$executeRaw` surfaces as Prisma's "raw query failed", with the real
      `23505` only in the message — so a check on `code` alone treats a name
      collision during a move as an unknown server error.
- [x] **A bare `ORDER BY "type"` sorted by the wrong thing.** The listing selects
      `"type"::text AS "type"` so the enum arrives as a string, and Postgres
      resolves an unqualified `ORDER BY` name against the **output** columns
      first — so it sorted by the text label and put `'file'` before `'folder'`
      alphabetically, which is the exact reverse of the enum order the whole
      folders-before-files rule rests on. Qualified as `"nodes"."type"` now; a
      qualified reference can only mean the input column. Caught by
      `API-NODES-015` on its first run.
- [x] **Prisma binds JS numbers as `bigint`.** `substring(text, bigint)` does not
      exist in Postgres, so the move UPDATE failed with
      `42883 function does not exist` — which reads as a typo rather than a type
      mismatch. Casts are explicit now. This is the line worth pointing at when
      justifying the property test: every earlier move test was a *rejection*, so
      the UPDATE had never once executed successfully.

## Must not depend on
`storage` (a file row does not know what a bucket is), `access` (authorization
is decided before this module is called), `auth`.

## Responsibilities
- [x] The `Node` and `Ancestry` contract above, as types the module exports
- [x] Physical schema and indexes — **deferred**, see §Storage. Pick the
      strategy, then write the DDL and the index list in the same change
- [x] `NodeAncestryService` — stated against the contract, so every item here
      survives a change of strategy
  - [x] `ancestorsOf(id)` → `Ancestry`, root first, excluding self, with
        `ancestorsDeleted` computed in the same read
  - [x] `assertNoCycle(source, target)`: reject when `target` is `source` or any
        descendant of it
  - [x] `assertDepth`: reject `targetDepth + subtreeHeight > MAX_DEPTH`
  - [x] `moveSubtree` — one statement, holding a row lock on the moved node
        taken **before** its ancestry is read. Under the materialized path that
        is `UPDATE … SET path = replace(path, $old, $new), depth = depth + $delta
        WHERE path LIKE $old || '%'` with a `SELECT … FOR UPDATE` ahead of it
  - [x] `deleteSubtree`, `statsFor` — same rule: a method here, never a
        predicate written by a caller
  - [x] `rebuildSubtree` — regenerates all derived ancestry from `parent_id`,
        exposed as a CLI command. This is the escape hatch if a migration
        corrupts state, and it is only writable because `parent_id` is the
        source of truth
- [x] `NodeNamingService`
  - [x] Normalize → sanitize → check → resolve
  - [x] Retry loop on `23505`, recomputing the suffix, capped at 10 attempts
- [x] `NodesService`
  - [x] Cascade soft-delete over the whole subtree, in one transaction, emitting
        `node.deleted` with the subtree id list. **`sharing` owns the listener**
        — this module only emits. (`access` is storage and resolution; the
        use-case that revokes grants sits above it.)
        Known limitation: the id list is unbounded, so deleting a large room
        puts every descendant id in one payload. Accepted for now; the fix when
        it hurts is to name the subtree by its root id and let the listener ask
        this module for the members
  - [x] Listing: keyset paginated, folders before files,
        `ORDER BY type, name COLLATE "C", id`. Raw SQL, because neither the
        collation nor the row-constructor keyset is expressible through Prisma's
        `orderBy` — and the collation is the whole point, not a preference
  - [x] Breadcrumbs come from `ancestorsOf` in the same response — one read,
        never a second round trip per crumb. The first version claimed this in a
        comment while issuing one `findById` per ancestor; `findManyByIds` is
        the read the comment described
- [ ] `NodeStatsService`
  - [x] Live subtree aggregate for delete confirmation
  - [ ] Denormalized `subtree_files` / `subtree_bytes` maintained by trigger for
        anything rendered in a list. **Still open, and now visible**: the
        listing serves these columns and nothing maintains them, so every folder
        reports 0. Honest while no file can exist; a lie the moment `files`
        lands, which is why `API-FILES-016` declares the maintenance

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
