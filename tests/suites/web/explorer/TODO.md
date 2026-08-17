# web/explorer

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/explorer/TODO.md`](../../../../apps/web/src/features/explorer/TODO.md)

The explorer is where a user spends every minute that is not uploading, so the
declaration list is deliberately long and repetitive. Creating a folder with a
duplicate name, a name of only spaces, and a name of 300 characters are three
rows rather than one, because they fail in three different layers.

## Declared tests

### Browsing and navigation

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-013 | Clicking a folder row opens that folder | unit | P1 |
| WEB-EXPLORER-014 | Clicking a file row opens the viewer, not the folder view | unit | P1 |
| WEB-EXPLORER-015 | A breadcrumb segment navigates to that ancestor | unit | P1 |
| WEB-EXPLORER-016 | The browser back button returns to the previous folder | unit | P1 |
| WEB-EXPLORER-017 | A folder URL opened directly renders that folder, not the root | unit | P1 |
| WEB-EXPLORER-018 | Reloading inside a nested folder stays there | unit | P1 |
| WEB-EXPLORER-019 | Navigating to a deleted folder renders a gone state, not a spinner | unit | P1 |
| WEB-EXPLORER-020 | Navigating to a folder id that never existed renders not-found | unit | P1 |
| WEB-EXPLORER-021 | An empty folder renders an empty state that offers the create and upload actions | unit | P1 |

### Creating a folder

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-022 | Creating a folder with a valid name adds it to the list without a refetch flash | unit | P1 |
| WEB-EXPLORER-023 | An empty name is rejected before the request | unit | P1 |
| WEB-EXPLORER-024 | A whitespace-only name is rejected before the request | unit | P1 |
| WEB-EXPLORER-025 | A name over `MAX_NAME_LENGTH` is rejected with the limit shown | unit | P1 |
| WEB-EXPLORER-026 | Leading and trailing whitespace is trimmed rather than rejected | unit | P1 |
| WEB-EXPLORER-027 | A name containing a path separator is rejected or sanitised, never sent raw | security | P1 |
| WEB-EXPLORER-028 | An emoji name is accepted and renders correctly | unit | P2 |
| WEB-EXPLORER-029 | A right-to-left name renders without reordering the surrounding UI | security | P1 |
| WEB-EXPLORER-030 | A duplicate name surfaces the 409 with the server's `suggestedName` | unit | P1 |
| WEB-EXPLORER-031 | Accepting the suggested name creates the folder in one further click | unit | P1 |
| WEB-EXPLORER-032 | Cancelling the dialog creates nothing | unit | P1 |
| WEB-EXPLORER-033 | Escape closes the dialog and creates nothing | unit | P1 |
| WEB-EXPLORER-034 | A failed create rolls the optimistic row back out of the list | unit | P1 |
| WEB-EXPLORER-035 | The name input is focused when the dialog opens | unit | P2 |

### Renaming

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-036 | Renaming updates the row in place | unit | P1 |
| WEB-EXPLORER-037 | Renaming to the identical name closes without an error | unit | P1 |
| WEB-EXPLORER-038 | Renaming to a sibling's name surfaces the conflict and the suggestion | unit | P1 |
| WEB-EXPLORER-039 | Renaming the folder you are inside updates the breadcrumb | unit | P1 |
| WEB-EXPLORER-040 | A failed rename restores the previous name | unit | P1 |
| WEB-EXPLORER-041 | The rename dialog opens pre-filled and with the name selected | unit | P2 |
| WEB-EXPLORER-042 | Renaming a file preserves its extension when only the stem is edited | unit | P1 |

### Moving

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-043 | Dragging a row onto a folder moves it | unit | P1 |
| WEB-EXPLORER-044 | Dragging a folder onto itself is refused with no request | unit | P1 |
| WEB-EXPLORER-045 | Dragging a folder onto its own descendant is refused | unit | P1 |
| WEB-EXPLORER-046 | Dragging onto a file row is not a drop target | unit | P1 |
| WEB-EXPLORER-047 | A drop target highlights on drag-over and clears on leave | unit | P2 |
| WEB-EXPLORER-048 | Dropping outside any target cancels the move | unit | P1 |
| WEB-EXPLORER-049 | Moving into a folder that already holds that name surfaces the conflict | unit | P1 |
| WEB-EXPLORER-050 | The move dialog warns when the destination is shared | security | P1 |
| WEB-EXPLORER-051 | The warning names which grant would newly apply | security | P1 |
| WEB-EXPLORER-052 | A failed move leaves the row in its original folder | unit | P1 |
| WEB-EXPLORER-053 | Moving refreshes both the source and destination listings | unit | P1 |

### Deleting

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-054 | Deleting a file asks for confirmation first | unit | P1 |
| WEB-EXPLORER-055 | The confirmation shows real subtree counts from `/stats` | unit | P1 |
| WEB-EXPLORER-056 | Deleting an empty folder says so rather than showing zeroes | unit | P2 |
| WEB-EXPLORER-057 | Cancelling the confirmation deletes nothing | unit | P1 |
| WEB-EXPLORER-058 | Deleting a folder that is shared warns that access will be revoked | security | P1 |
| WEB-EXPLORER-059 | Deleting the folder you are viewing navigates to its parent | unit | P1 |
| WEB-EXPLORER-060 | A failed delete restores the row | unit | P1 |
| WEB-EXPLORER-061 | Deleting refreshes ancestor stats | unit | P2 |

### Selection and bulk actions

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-062 | Shift-click selects a contiguous range | unit | P1 |
| WEB-EXPLORER-063 | Ctrl or Cmd click toggles a single row | unit | P1 |
| WEB-EXPLORER-064 | Select-all selects only the loaded page and says so | unit | P1 |
| WEB-EXPLORER-065 | Navigating away clears the selection | unit | P1 |
| WEB-EXPLORER-066 | Bulk delete confirms once with the combined counts | unit | P1 |
| WEB-EXPLORER-067 | A partially failed bulk action reports which items failed | unit | P1 |
| WEB-EXPLORER-068 | Bulk actions are hidden when nothing is selected | unit | P2 |

### Sorting, pagination, and large folders

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-069 | Scrolling to the bottom loads the next keyset page once | unit | P1 |
| WEB-EXPLORER-070 | A folder with 500 children scrolls without duplicate or missing rows | unit | P1 |
| WEB-EXPLORER-071 | Creating an item while paginated does not duplicate a row | unit | P1 |
| WEB-EXPLORER-072 | Non-ASCII names sort consistently with the server's order | unit | P1 |

### Staleness and concurrent change

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-073 | Refocusing the window refetches the current listing | unit | P1 |
| WEB-EXPLORER-074 | Acting on a row deleted in another tab shows a gone state, not a crash | unit | P1 |
| WEB-EXPLORER-075 | Acting on a row renamed elsewhere refreshes rather than writing stale data | unit | P1 |
| WEB-EXPLORER-076 | A 409 from any action never leaves the UI in a pending state | unit | P1 |

### Read-only mode

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-001 | `readOnly` removes every mutating control — absent, not disabled | security | P0 |
| WEB-EXPLORER-077 | `readOnly` renders no row context menu | security | P1 |
| WEB-EXPLORER-078 | `readOnly` ignores drag gestures entirely | security | P1 |
| WEB-EXPLORER-079 | `readOnly` renders no upload dropzone | security | P1 |
| WEB-EXPLORER-080 | Keyboard shortcuts that mutate are inert in `readOnly` | security | P1 |
| WEB-EXPLORER-081 | `readOnly` offers no create action from the **empty state** either | security | P0 |

### Existing declarations

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-EXPLORER-002 | Folders sort before files | unit | P1 |
| WEB-EXPLORER-003 | Breadcrumbs collapse to an ellipsis past depth 4 | unit | P1 |
| WEB-EXPLORER-004 | Create and rename apply optimistically and roll back on error | unit | P1 |
| WEB-EXPLORER-005 | Move and delete are not optimistic | unit | P1 |
| WEB-EXPLORER-006 | A 409 offers the `suggestedName` as a one-click action | unit | P1 |
| WEB-EXPLORER-007 | Double-clicking create submits once | unit | P1 |
| WEB-EXPLORER-008 | The delete dialog shows real subtree counts from `/stats` | unit | P1 |
| WEB-EXPLORER-009 | The move dialog warns when the destination is shared | security | P1 |
| WEB-EXPLORER-010 | Every view has an empty, loading, error, and gone state — none is a bare spinner | unit | P1 |
| WEB-EXPLORER-011 | Infinite scroll requests the next keyset page exactly once per boundary | unit | P1 |
| WEB-EXPLORER-012 | Keyboard: arrows move, Enter opens, Backspace goes up | unit | P2 |

## Notes
- WEB-EXPLORER-050 and -009 overlap on purpose: -009 asserts the warning exists,
  -050 asserts it appears for the right destination. Keep both; the first is the
  feature and the second is the bug that gets shipped.
- The `readOnly` group is security, not cosmetics. It is the only thing standing
  between a share visitor and a delete button.
- WEB-EXPLORER-081 was added while implementing, and it is not a duplicate of
  -001. The empty state is rendered by a **different branch** than the table, so
  a `readOnly` guard applied to the row actions and the header can be complete
  and still leave a create button on every empty folder — which is the one a
  share visitor is most likely to land on.
