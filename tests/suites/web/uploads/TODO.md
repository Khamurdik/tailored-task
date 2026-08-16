# web/uploads

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/uploads/TODO.md`](../../../../apps/web/src/features/uploads/TODO.md)

Uploading is the longest-running thing a user does, which means it is the thing
most likely to be interrupted. Most of these declarations are interruptions.

## Declared tests

### Starting an upload

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-011 | Dropping one file onto the content area queues it | unit | P1 |
| WEB-UPLOADS-012 | Choosing files through the file picker queues them identically | unit | P1 |
| WEB-UPLOADS-013 | Dropping 20 files queues 20 items | unit | P1 |
| WEB-UPLOADS-014 | The whole content area is a drop target, not just a small zone | unit | P1 |
| WEB-UPLOADS-015 | Dragging over shows an overlay and leaving clears it | unit | P1 |
| WEB-UPLOADS-016 | Dropping outside the target does nothing and shows no error | unit | P1 |
| WEB-UPLOADS-017 | Files land in the folder currently being viewed | unit | P1 |
| WEB-UPLOADS-018 | Dropping onto a specific folder row targets that folder | unit | P1 |
| WEB-UPLOADS-019 | Dropping a directory is either expanded or refused with an explanation, never silently ignored | unit | P1 |

### Validation and rejection

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-020 | A file over `MAX_FILE_SIZE` is rejected before any request | unit | P1 |
| WEB-UPLOADS-021 | The rejection names the file and the limit | unit | P1 |
| WEB-UPLOADS-022 | A zero-byte file is rejected with its own message | unit | P1 |
| WEB-UPLOADS-023 | A non-PDF is rejected client-side when PDF-only is enforced | unit | P1 |
| WEB-UPLOADS-024 | A mixed drop uploads the valid files and reports only the rejected ones | unit | P1 |
| WEB-UPLOADS-025 | An all-rejected drop leaves the queue untouched | unit | P1 |
| WEB-UPLOADS-026 | A file whose name collides is uploaded and reported under its resolved name | unit | P1 |

### Progress and feedback

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-027 | Progress advances from real XHR events, not a simulated timer | unit | P1 |
| WEB-UPLOADS-028 | A "finalizing" state shows between 100 percent and the complete response | unit | P1 |
| WEB-UPLOADS-029 | The panel shows an aggregate of remaining files | unit | P2 |
| WEB-UPLOADS-030 | A completed file shows its final name and a link to it | unit | P1 |
| WEB-UPLOADS-031 | The panel distinguishes done, failed, and cancelled at a glance | unit | P1 |

### Cancelling and retrying

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-032 | Cancelling one file aborts its request and leaves the others running | unit | P1 |
| WEB-UPLOADS-033 | Cancelling calls `/abort` so the pending node is cleaned up | unit | P1 |
| WEB-UPLOADS-034 | Cancel-all aborts every in-flight and queued item | unit | P1 |
| WEB-UPLOADS-035 | A cancelled file can be retried without re-dropping it | unit | P1 |
| WEB-UPLOADS-036 | Retry after a network failure resumes from init, not from a stale URL | unit | P1 |
| WEB-UPLOADS-037 | Retrying does not duplicate the file | unit | P1 |

### Interruption and persistence

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-001 | Navigating away does not cancel in-flight uploads | unit | P0 |
| WEB-UPLOADS-038 | Navigating two folders away keeps every transfer running | unit | P1 |
| WEB-UPLOADS-039 | Closing the tab during a transfer triggers the beforeunload warning | unit | P1 |
| WEB-UPLOADS-040 | No beforeunload warning appears when the queue is idle | unit | P1 |
| WEB-UPLOADS-041 | Losing the network mid-transfer marks the file failed rather than hanging | unit | P1 |
| WEB-UPLOADS-042 | A presigned URL that expires mid-transfer surfaces as a retryable failure | unit | P1 |
| WEB-UPLOADS-043 | An access token expiring mid-transfer does not lose the queue | unit | P1 |

### Queue management

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-002 | Concurrency is capped at 3 regardless of how many files are dropped | unit | P1 |
| WEB-UPLOADS-044 | A fourth file starts only when a slot frees | unit | P1 |
| WEB-UPLOADS-045 | Dropping more files while uploading appends rather than restarting | unit | P1 |
| WEB-UPLOADS-046 | The queue survives dismissing and reopening the panel | unit | P1 |
| WEB-UPLOADS-047 | Clearing completed items leaves in-flight ones alone | unit | P2 |

### Existing declarations

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-UPLOADS-003 | Each file walks queued to initializing to uploading to completing to done | unit | P1 |
| WEB-UPLOADS-004 | Cancel aborts the request and calls `/abort` | unit | P1 |
| WEB-UPLOADS-005 | A failed file can be retried without re-dropping it | unit | P1 |
| WEB-UPLOADS-006 | A "finalizing" state shows between 100% and the `/complete` response | unit | P1 |
| WEB-UPLOADS-007 | Each completion invalidates the target folder, not one batch at the end | unit | P1 |
| WEB-UPLOADS-008 | A resolved name that differs is surfaced to the user | unit | P1 |
| WEB-UPLOADS-009 | The panel is dismissible and reappears on a new upload | unit | P2 |
| WEB-UPLOADS-010 | Queue state lives in zustand, not in the query cache | unit | P1 |
