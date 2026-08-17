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
- [x] `react-dropzone`; the whole content area is a drop target, with a clear
      overlay on drag-over — **plus a visible "Upload files" button**, because
      dragging is undiscoverable, impossible on touch, and awkward with a screen
      reader. For most people the button is the primary path, not the fallback
- [x] Per-file state machine: `queued → initializing → uploading → completing → done | error | cancelled`
- [x] Real progress via `onUploadProgress` — axios's wrapper over the XHR
      upload event, so the number is a real byte count rather than a timer
- [x] Concurrency cap of 3. An unbounded queue on a 200-file drop renders 200
      simultaneous 0% bars and looks broken.
- [x] `AbortController` per file; cancel calls `/abort`
- [x] Retry on a failed file without re-dropping — **from `init`**, not from the
      presigned URL, since an expired URL is the usual reason a retry is needed
- [x] Show "finalizing" between 100% and the `/complete` response — otherwise
      the bar sits full while nothing appears to happen
- [x] `beforeunload` warning while transfers are in flight, and **only** then —
      an always-registered handler trains people to click through it
- [x] Invalidate on each completion, not once at the end
- [x] Surface the resolved name when it differs: "uploaded as report (2).pdf"

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

## Implementation notes

- [x] **The bytes travel on their own axios instance, and that is load-bearing
      twice over.** It carries no credential — the app's `api` client attaches a
      bearer or share token to every request, and sending one to a storage host
      puts a session token in somebody else's access log; the signature in the
      presigned URL is the entire authorization. And it goes through
      `installMockTransport`, so the placeholder data layer answers the fake
      `mock://uploads/...` PUT.

      The first version used a bare `XMLHttpRequest`, which bypasses the axios
      adapter entirely. It would have worked against a real bucket and failed
      silently in `VITE_API_MODE=mock` — which is the only mode anyone can run
      today, since no S3 bucket exists. Found by a user trying to drag a file in.
- [x] **The runner and the panel are mounted above the router**, outside
      `<Routes>`. Inside a route, navigating into a folder unmounts them and
      every transfer dies — which is `WEB-UPLOADS-001` and the bug that makes
      people re-drop files and end up with duplicates.
- [x] The abort handles and the started-set are **module-level**, not refs. Two
      different parts of the tree need to reach a running transfer, and the first
      draft had a private ref in the runner plus a second map for the cancel
      button — never connected, so cancelling marked an item cancelled while its
      bytes kept going.
