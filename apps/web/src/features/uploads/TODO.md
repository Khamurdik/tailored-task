# web/features/uploads

## Purpose
The transfer queue: drag-drop, per-file progress, cancel, retry.

## Owns
Upload queue state — in a zustand store, deliberately **not** in react-query.
Transfer progress is client state, and putting it in the query cache means
uploads die on navigation.

## Public surface
- `<UploadDropzone targetNodeId />`
- `<UploadPanel />` — docked, persists across navigation
- `useUploadQueue()`

## Depends on
`shared`, `packages/shared`.

## Must not depend on
`explorer`. The dropzone is composed into the explorer route, not imported by it.

## Responsibilities
- [ ] `react-dropzone`; the whole content area is a drop target, with a clear
      overlay on drag-over
- [ ] Per-file state machine: `queued → initializing → uploading → completing → done | error | cancelled`
- [ ] Real progress via XHR `onUploadProgress` — this is the payoff for
      presigned direct-to-S3 uploads, so make sure it is visibly smooth
- [ ] Concurrency cap of 3. An unbounded queue on a 200-file drop renders 200
      simultaneous 0% bars and looks broken.
- [ ] `AbortController` per file; cancel calls `/abort`
- [ ] Retry on a failed file without re-dropping
- [ ] Show "finalizing" between 100% and the `/complete` response — otherwise
      the bar sits full while nothing appears to happen
- [ ] `beforeunload` warning while transfers are in flight
- [ ] Invalidate the target folder's children on each completion, not once at the end
- [ ] Surface the resolved name when it differs: "uploaded as report (2).pdf"

## Showing the queue in other tabs

Wanted: open the app in a second tab and see the same upload progress. Partly
possible, and the limit is worth stating before anyone builds it.

**What can be shared: the display.** Mirror queue state onto a
`BroadcastChannel('uploads')` — one message per state transition plus a throttled
progress tick (~4/s; per-byte events would flood the channel). Other tabs render
from the mirror. A new tab asks for a snapshot on mount and the owning tab
replies.

**What cannot be shared: the transfer.** The bytes move through an `XMLHttpRequest`
belonging to the tab that started them. No browser API hands a live request to
another tab, and re-issuing it elsewhere would upload the file twice. So:

- [ ] Every queue item carries the id of the tab that owns it
- [ ] Non-owning tabs render progress read-only — **no cancel, no retry**. A
      cancel button that silently does nothing is worse than no button
- [ ] If the owning tab goes away, its in-flight items are marked `interrupted`
      in the surviving tabs, with retry offered there. Retry restarts the
      upload in the tab that clicked it; it does not resume. Detect via a
      heartbeat on the channel, not `beforeunload`, which does not fire reliably
- [ ] The already-specified `pending` reaper cleans up whatever this leaves
      behind server-side, so a dropped tab costs an orphan row for at most an
      hour and nothing else
- [ ] **Optional.** Single-tab uploading is the requirement; this is polish. Cut
      it before cutting anything in the core path

Do not put the mirror in `localStorage`. It would fire a `storage` event per
progress tick in every tab, and the token store's own `storage` listener is
already load-bearing for cross-tab logout.

## Invariants
- Navigating away does not cancel uploads.
- The panel is dismissible but reappears on a new upload.
- A transfer is owned by exactly one tab, and only that tab can cancel it.

## Done when
20 files dropped into a folder, then immediately navigating two levels away,
still completes and reports every result.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/uploads/TODO.md`](../../../../../tests/suites/web/uploads/TODO.md) and implemented there — never in this module's folder.
