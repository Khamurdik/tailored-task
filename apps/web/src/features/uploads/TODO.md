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

## Invariants
- Navigating away does not cancel uploads.
- The panel is dismissible but reappears on a new upload.

## Done when
20 files dropped into a folder, then immediately navigating two levels away,
still completes and reports every result.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/uploads/TODO.md`](../../../../../tests/suites/web/uploads/TODO.md) and implemented there — never in this module's folder.
