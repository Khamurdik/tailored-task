# api/search — DEFERRED module

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/search/TODO.md`](../../../../apps/api/src/search/TODO.md)

`search` is **deferred and out of scope** — see
[`apps/api/src/search/TODO.md`](../../../../apps/api/src/search/TODO.md). These
declarations stay because the module may be picked up later and because they are
the part that would be got wrong: this is the easiest place in the system to
leak the existence of a node. They count as declared and unimplemented, which is
correct — the module is not built.

## Declared tests

### Leak prevention

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-SEARCH-001 | A stranger's search returns nothing from a room they cannot see | security | P1 |
| API-SEARCH-002 | A shared-folder visitor sees results only from within that subtree | security | P1 |
| API-SEARCH-003 | Results never include a node the actor cannot read | security | P1 |
| API-SEARCH-004 | Filtering happens before pagination, so page sizes stay predictable | integration | P1 |
| API-SEARCH-005 | Search is always scoped by `root_id` and never crosses rooms | security | P1 |

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
