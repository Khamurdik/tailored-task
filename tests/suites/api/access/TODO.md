# api/access

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/access/TODO.md`](../../../../apps/api/src/access/TODO.md) ·
invariant 7 in [`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md)

`resolveAccess` is a pure function with no injected dependencies, which is what
makes the full permission matrix a millisecond unit test instead of an e2e
suite. This suite is the payoff for that design decision — cite it in the README.

## Declared tests

### The matrix and inheritance

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-ACCESS-001 | Permission matrix: {owner, invited viewer, public token, stranger, anonymous} × {room, folder, file} × {read, write, own} | security | P0 |
| API-ACCESS-002 | A grant on a grandparent resolves on a grandchild | unit | P1 |
| API-ACCESS-003 | Effective role is the maximum across self and all ancestors | unit | P1 |
| API-ACCESS-004 | When two ancestor grants differ, the higher role wins | unit | P1 |

### Grants that must not resolve

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-ACCESS-005 | A grant on a soft-deleted ancestor resolves to `none` | security | P0 |
| API-ACCESS-006 | A grant on a soft-deleted target resolves to `none` | security | P0 |
| API-ACCESS-007 | An expired grant resolves to `none` without stubbing the clock | unit | P0 |
| API-ACCESS-008 | A revoked grant resolves to `none` | unit | P0 |
| API-ACCESS-009 | Expired and revoked grants are excluded in SQL, not filtered in JS | integration | P1 |

### Denial and boundaries

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-ACCESS-010 | Denial returns 404, never 403 | security | P0 |
| API-ACCESS-011 | A denied request and a nonexistent id are byte-identical responses | security | P0 |
| API-ACCESS-012 | Ancestor ids come from `node.path` — resolution issues one grant query regardless of depth | integration | P1 |
| API-ACCESS-013 | The `editor` role is defined in the enum and never issued by any code path | unit | P1 |
| API-ACCESS-014 | No module outside `access` reads the `shares` table | security | P1 |

## Notes
- **API-ACCESS-001 is the flagship.** Table-driven, ~24+ cases, pure, runs in
  milliseconds. Write it as data, not as 24 `it()` blocks, but give each case a
  generated title containing the actor and the expectation so a failure names
  itself.
- API-ACCESS-011 is stronger than API-ACCESS-010 and easy to get wrong: equal
  status codes but different bodies or timings still leak existence.
- API-ACCESS-014 is a static check over the source tree, not a runtime test.
  It defends the boundary the whole module exists to create.
