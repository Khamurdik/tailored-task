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
- [ ] Fetch `/nodes/:id/content-url` on open — never cache the signed URL, it
      expires in 60 seconds
- [ ] `<iframe>` on the signed URL. Reach for `react-pdf` only if page
      navigation is actually wanted; the browser viewer is better than a
      half-built one.
- [ ] Route-addressable (`/rooms/:id/f/:fileId`) so a view is linkable and back
      works
- [ ] Download button reusing the same URL
- [ ] Loading, unsupported-type, and expired-URL states; expiry refetches rather
      than erroring

## Invariants
- Works identically inside a share view. Same component, same endpoint, the
  guard decides.

## Done when
A PDF opens from both the owner view and a public link, and a stale modal left
open for five minutes recovers on interaction.
