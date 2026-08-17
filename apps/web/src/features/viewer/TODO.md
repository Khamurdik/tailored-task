# web/features/viewer

## Purpose
View a PDF in the UI.

## Owns
Nothing.

## Public surface
`<FileViewer nodeId />`

## Depends on
`shared`.

## Responsibilities
- [x] Fetch `/nodes/:id/content-url` on open — never cache the signed URL, it
      expires in 60 seconds. `staleTime: 0` **and** `gcTime: 0`; the second is
      the one that is easy to miss, and without it the entry survives unmount so
      reopening five minutes later frames a long-dead URL
- [x] `<iframe>` on the signed URL — **only when the node's content type is
      `application/pdf`**. The browser's own viewer, so page navigation, search,
      print and zoom all come free. `sandbox=""` on the frame as well: even a
      PDF is served from the storage origin, and a preview has no reason to run
      scripts or navigate the top-level page
- [x] Any other type renders the unsupported-type state with a download action,
      never an `<iframe>`. The check is an **early return before every other
      branch**, so no sequence of loading states, retries or races can reach the
      frame — structural rather than conditional. It is a positive match on one
      media type, not a blocklist, because a blocklist is wrong the day a new
      type is added
- [x] Route-addressable so a view is linkable and back works. **`/nodes/:id/f/:fileId`**
      rather than the `/rooms/...` the spec wrote: the tree is addressed by node
      id throughout, and a second addressing scheme for one route would be a
      second thing to keep true
- [x] Download button reusing the same URL — every issued URL is another
      unrevocable sixty-second credential, so minting one per button press is a
      real cost. Rendered as an `<a>` with `buttonVariants`, not a `Button`,
      because it navigates
- [x] Loading, unsupported-type, error and expired-URL states; expiry refetches
      rather than erroring, **on interaction rather than on a timer** — a
      `setInterval` refreshing a signed URL keeps a credential alive for as long
      as the tab is open, which is the opposite of what the TTL is for

## Implementation notes

- [x] The header's download link is rendered **only for a previewable file**.
      An unsupported type puts its download in the body as the single prominent
      action; two links with the same accessible name in one dialog is ambiguous
      to a screen reader and to anything scripting it.
- [x] Expiry recovery refetches straight from the event handler rather than
      setting a `stale` flag an effect reacts to. The flag version was a
      cascading render and bought nothing — the event already *is* the
      interaction.

## Invariants
- Works identically inside a share view. Same component, same endpoint, the
  guard decides.

## Done when
A PDF opens from both the owner view and a public link, and a stale modal left
open for five minutes recovers on interaction.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/viewer/TODO.md`](../../../../../tests/suites/web/viewer/TODO.md) and implemented there — never in this module's folder.
