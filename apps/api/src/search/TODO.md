# search — L3 · optional

## Purpose
Find files and folders by name within one room. Extra credit — cut this before
cutting anything else.

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
- [ ] A stranger's search returns nothing from a room they cannot see
- [ ] A shared-folder visitor sees results only from within that subtree
- [ ] Accented and Cyrillic queries match

## Done when
Search across a 1000-node room returns in under 100ms and leaks nothing.
