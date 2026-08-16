# web/viewer

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/web/src/features/viewer/TODO.md`](../../../../apps/web/src/features/viewer/TODO.md)

## Declared tests

### Opening and rendering

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-VIEWER-006 | Opening a file renders the PDF | unit | P1 |
| WEB-VIEWER-007 | The viewer shows the file name and size | unit | P2 |
| WEB-VIEWER-008 | Closing returns to the folder that was being viewed | unit | P1 |
| WEB-VIEWER-009 | Escape closes the viewer | unit | P2 |
| WEB-VIEWER-010 | Opening a non-PDF renders an unsupported-type state with a download option | unit | P1 |
| WEB-VIEWER-011 | A file that fails to load renders an error with a retry, not a blank frame | unit | P1 |

### Signed-URL lifetime

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-VIEWER-001 | The signed URL is fetched on open and never cached | security | P1 |
| WEB-VIEWER-002 | An expired URL refetches rather than erroring | unit | P1 |
| WEB-VIEWER-012 | A modal left open for five minutes recovers on the next interaction | unit | P1 |
| WEB-VIEWER-013 | The signed URL never appears in a query key or the address bar | security | P1 |
| WEB-VIEWER-014 | Reopening the same file requests a fresh URL | security | P1 |

### Downloading and context

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| WEB-VIEWER-015 | Download reuses the same signed URL rather than requesting another | unit | P1 |
| WEB-VIEWER-016 | The downloaded file keeps its display name | unit | P1 |
| WEB-VIEWER-003 | The viewer is route-addressable and back works | unit | P1 |
| WEB-VIEWER-004 | The same component renders inside a share view | unit | P1 |
| WEB-VIEWER-005 | Loading and unsupported-type states render | unit | P1 |
| WEB-VIEWER-017 | The viewer offers no delete or rename affordance in a share view | security | P1 |
| WEB-VIEWER-018 | A non-PDF content type renders the unsupported-type state and never an `<iframe>` | security | P0 |
