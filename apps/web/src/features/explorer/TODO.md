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
- [x] Breadcrumb bar, collapsing to an ellipsis menu past depth 4 — in the
      **middle**, so the room and the current folder both survive
- [x] Table: name, size, modified, row actions. Folders sort first — **as the
      server sent them**, never re-sorted client-side, because the keyset cursor
      compares under `COLLATE "C"` and a client that re-sorted would disagree
      with it at every page boundary
- [x] Infinite scroll on the keyset cursor, guarded so one boundary requests one
      page
- [ ] Create and rename dialogs, **optimistic** — rollback is trivial.
      **Not done.** Both close on success and let the shared `MutationCache`
      invalidate `['nodes']`, so a row appears after a refetch rather than
      immediately. Correct, and a visible flash on a slow connection. Deferred
      deliberately: an optimistic update whose rollback is untested is worse
      than none, and its failure mode is a row that exists only on the client
- [x] Move and delete, **not optimistic** — they touch multiple cache entries
      plus ancestor stats, and a correct rollback costs more than the feature
      is worth. Say so in the README; choosing this deliberately is the point.
- [x] Delete confirmation showing real subtree counts from `/stats`:
      "This deletes 3 folders and 12 files" — and "This folder is empty" rather
      than two zeroes
- [ ] Move dialog warns when the destination is shared. **Not done** — the move
      itself works but its destination chooser is a placeholder, so there is
      nothing yet that knows which grants apply to a destination
- [x] 409 `NAME_CONFLICT` offers the `suggestedName` as a one-click action — and
      it is the *server's* suggestion, because the client cannot see the sibling
      set and any name it invented would be a guess
- [x] Disable submit while `isPending` — a double-click otherwise creates two folders
- [ ] Drag a row onto a folder to move it. **Not done**
- [ ] Bulk select with shift-click; bulk move and delete. **Not done**
- [x] The empty state's copy no longer promises uploading before `uploads`
      exists. It said "drop files here to upload them" while nothing handled a
      drop, which is precisely the "do not ship unimplemented features" rule
      broken by a sentence rather than by a control
- [x] Empty, loading, error, and gone states for every view — and a gone folder
      renders the same thing as one that never existed, because the API answers
      both with the same 404 and a UI that distinguished them would be inventing
      a difference the server refuses to expose
- [ ] Keyboard: arrows, Enter to open, Backspace to go up, `/` to focus search.
      **Not done**

## Implementation notes

- [x] **`readOnly` removes controls; it never disables them.** A disabled
      control is still a control — it is in the DOM, it can be re-enabled from a
      console, and it tells a share visitor exactly which operations exist. The
      empty state needed its own guard: it renders from a different branch than
      the table, so a complete-looking `readOnly` pass over the rows and the
      header still left a create button on every empty folder. That is
      `WEB-EXPLORER-081`, added while implementing.
- [x] **The dialog form is a separate component mounted only while open**, so
      `useState(initialName)` initialises from the right value each time. The
      first version synchronised with an effect, which lints as a cascading
      render and is subtly wrong as well: the effect runs after the first paint,
      so a rename dialog showed the *previous* node's name for a frame.
- [x] Two buttons must not share an accessible name in one view. The empty
      state's action is "Create a folder" rather than a second "New folder".

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
