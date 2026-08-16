# web/features/explorer

## Purpose
Browse the tree and mutate it: breadcrumbs, listing, create, rename, move,
delete.

## Owns
Nothing. All state is server state.

## Public surface
- `<Explorer nodeId readOnly />` — the `readOnly` prop is how `public-view`
  reuses this without either feature importing the other

## Depends on
`shared`, `packages/shared`.

## Must not depend on
`uploads`, `sharing`, `public-view`. Composition happens at the route level.

## Responsibilities
- [ ] Breadcrumb bar, collapsing to an ellipsis menu past depth 4
- [ ] Table: name, size, modified, row actions. Folders sort first.
- [ ] Infinite scroll on the keyset cursor
- [ ] Create and rename dialogs, **optimistic** — rollback is trivial
- [ ] Move and delete, **not optimistic** — they touch multiple cache entries
      plus ancestor stats, and a correct rollback costs more than the feature
      is worth. Say so in the README; choosing this deliberately is the point.
- [ ] Delete confirmation showing real subtree counts from `/stats`:
      "This deletes 3 folders and 12 files"
- [ ] Move dialog warns when the destination is shared
- [ ] 409 `NAME_CONFLICT` offers the `suggestedName` as a one-click action
- [ ] Disable submit while `isPending` — a double-click otherwise creates two folders
- [ ] Drag a row onto a folder to move it
- [ ] Bulk select with shift-click; bulk move and delete
- [ ] Empty, loading, error, and gone states for every view
- [ ] Keyboard: arrows, Enter to open, Backspace to go up, `/` to focus search

## Invariants
- `readOnly` hides every mutating affordance. Not disabled — absent. The brief
  says not to ship unimplemented features, and a greyed-out delete button in a
  read-only view reads as broken rather than intentional.

## Done when
A 5-level tree is navigable by keyboard and mouse, every dialog handles its
error case, and no state renders as a bare spinner.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/explorer/TODO.md`](../../../../../tests/suites/web/explorer/TODO.md) and implemented there — never in this module's folder.
