# api/search — optional module

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/search/TODO.md`](../../../../apps/api/src/search/TODO.md)

`search` is extra credit, but its security tests are not optional *if the module
ships*. This is the easiest place in the system to leak the existence of a node.

## Declared tests

### Leak prevention

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SEARCH-001 | A stranger's search returns nothing from a room they cannot see | security | P0 |
| API-SEARCH-002 | A shared-folder visitor sees results only from within that subtree | security | P0 |
| API-SEARCH-003 | Results never include a node the actor cannot read | security | P0 |
| API-SEARCH-004 | Filtering happens before pagination, so page sizes stay predictable | integration | P0 |
| API-SEARCH-005 | Search is always scoped by `root_id` and never crosses rooms | security | P0 |

### Behaviour and performance

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SEARCH-006 | A query under 3 characters returns empty without a table scan | integration | P1 |
| API-SEARCH-007 | Accented and Cyrillic queries match | integration | P1 |
| API-SEARCH-008 | Results carry the full breadcrumb path derived from `path` | integration | P2 |
| API-SEARCH-009 | A 1000-node room returns in under 100ms | integration | P2 |

## Notes
- If the module is cut, mark every row `RETIRED` rather than deleting the file.
  The declarations are the record of what was in scope.
