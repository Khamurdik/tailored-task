# search — L3 · DEFERRED — do not implement

> **Status: not in scope.** Second priority, behind the core path and `jobs`,
> ahead of `audit`. Do not start this module and do not add the `pg_trgm`
> extension or the GIN index "for later".
>
> This file stays in the repo as a design note, so the decision is visible and
> the module can be picked up later without rediscovering it.

## Why it is deferred, not cut

The hard part is not the search — it is that results must be filtered by
permission *before* pagination, while `access` is built to resolve one node at a
time behind a guard. Per-row resolution over a result page is N queries; doing
it in SQL puts the grant logic in a second place, which is exactly what the
pure-resolver design exists to prevent. It also destabilises the keyset cursor,
because a permission-filtered set is not a contiguous index range.

Nothing depends on this module, so deferring it is free. When it is picked up,
the cheap version is to restrict search to subtrees the actor can already read
wholesale — that sidesteps the filtering problem entirely and covers the real
use case.

## Purpose
Find files and folders by name within one room.

## Owns
Nothing. Reads `nodes`.

## Public surface
`GET /rooms/:rootId/search?q=&cursor=`

## Depends on
`common`, `nodes`, `access`.

## Responsibilities
- [ ] `pg_trgm` extension + GIN index on `name`
- [ ] Always scope by `root_id` — never search across rooms
- [ ] Minimum 3 characters; shorter queries return empty, not a table scan
- [ ] Results carry the full breadcrumb path, derived from `path`
- [ ] Filter out nodes the actor cannot read **before** paginating, or page
      sizes become unpredictable
- [ ] Debounce 300ms client-side

## Invariants
- A search result must never reveal the existence of a node the actor cannot
  read. This is the easiest place in the system to accidentally leak.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/search/TODO.md`](../../../../tests/suites/api/search/TODO.md) and implemented there — never in this module's folder.
- [ ] A stranger's search returns nothing from a room they cannot see
- [ ] A shared-folder visitor sees results only from within that subtree
- [ ] Accented and Cyrillic queries match

## Done when
Search across a 1000-node room returns in under 100ms and leaks nothing.
