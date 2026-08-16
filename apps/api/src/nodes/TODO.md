# nodes — L1

## Purpose
The tree. Rooms, folders, and files are one table; this module is the sole
writer of it and the only place that understands paths.

## Owns
`nodes` table, and the `path` / `depth` invariants on it.

## Public surface
- `NodesService` — create room, create folder, rename, move, soft-delete, list children
- `NodesRepository` — also satisfies `access`'s `NodeLookupPort`
- `NodePathService` — `buildPath`, `parseAncestors`, `assertNoCycle`, `rebuildSubtree`
- `NodeNamingService` — conflict detection and resolution
- `NodeStatsService` — subtree counts and bytes

## Depends on
`common`.

## Must not depend on
`storage` (a file row does not know what a bucket is), `access` (authorization
is decided before this module is called), `auth`.

## Responsibilities
- [ ] Schema per `docs/ARCHITECTURE.md`, plus all five indexes
- [ ] `NodePathService`
  - [ ] `path` built from ancestor ids, ending in self, `/`-delimited
  - [ ] `assertNoCycle`: reject when `target.path` starts with `source.path`
  - [ ] `assertDepth`: reject `newDepth + subtreeHeight > MAX_DEPTH`
  - [ ] Move as a single `UPDATE … SET path = replace(path, $old, $new),
        depth = depth + $delta WHERE path LIKE $old || '%'`
  - [ ] `SELECT … FOR UPDATE` on the moved node before reading its path
  - [ ] `rebuildSubtree` — regenerates paths from `parent_id`, exposed as a CLI
        command. This is the escape hatch if a migration corrupts state.
- [ ] `NodeNamingService`
  - [ ] Normalize → sanitize → check → resolve
  - [ ] Retry loop on `23505`, recomputing the suffix, capped at 10 attempts
- [ ] `NodesService`
  - [ ] Cascade soft-delete via path prefix, in one transaction, emitting
        `node.deleted` with the subtree id list so `access` can revoke grants
  - [ ] Listing: keyset paginated, folders before files,
        `ORDER BY type, name COLLATE "C", id`
  - [ ] Breadcrumbs derived from `path` in the same response — no second query
- [ ] `NodeStatsService`
  - [ ] Live prefix aggregate for delete confirmation
  - [ ] Denormalized `subtree_files` / `subtree_bytes` maintained by trigger for
        anything rendered in a list

## Invariants
Invariants 1–6 in `docs/ARCHITECTURE.md` are this module's responsibility.

Additionally: the cursor's collation must match the `ORDER BY` collation
exactly. A mismatch silently skips or duplicates rows at page boundaries, and
it only manifests with non-ASCII names.

## Tests
- [ ] **Property test**: 200 random ops (create / move / rename / delete), then
      assert every path matches its ancestor chain, `depth == segments - 1`, no
      cycles, and no live node under a deleted parent. This is the highest-value
      test in the repo — write it before folder CRUD exists.
- [ ] Move into own descendant rejected; move to self rejected
- [ ] Depth cap rejected with 400, not a Postgres error
- [ ] Cascade delete leaves nothing half-done after a forced rollback
- [ ] Concurrent same-name creation: 10 parallel requests → 10 distinct names, no 500s
- [ ] Subtree stats match a naive recursive walk
- [ ] Pagination over 500 children with Cyrillic and accented names loses nothing

## Done when
The property test passes and a 5-level tree can be created, moved, listed, and
cascade-deleted with paths intact throughout.
