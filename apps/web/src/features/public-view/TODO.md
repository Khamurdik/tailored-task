# web/features/public-view

## Purpose
The read-only shell at `/s/:token`. A thin wrapper, not a second application.

## Owns
Nothing.

## Public surface
The `/s/:token` route.

## Depends on
`shared`, `explorer` (as a composed component), `viewer`.

## Responsibilities
- [ ] Resolve the token via `/shares/resolve` → root node of the share
- [ ] Render `<Explorer readOnly />` scoped to that root
- [ ] Breadcrumbs stop at the share root — never reveal ancestors above it
- [ ] Minimal header: item name, "Shared with you", no account menu
- [ ] `Referrer-Policy: no-referrer` on this route
- [ ] Distinct screens for invalid, revoked, expired, and deleted
- [ ] If the visitor happens to be signed in, still show the read-only view —
      do not silently upgrade them into the owner UI

## Invariants
- **Nothing in this route may reuse an owner-scoped query key.** Sharing a
  cache entry between the owner view and the share view is the mechanism by
  which private data leaks into a public page. Namespace the keys by token.
- This route never redirects to login.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/public-view/TODO.md`](../../../../../tests/suites/web/public-view/TODO.md) and implemented there — never in this module's folder.
- [ ] Playwright: owner uploads → shares → **second browser context with no
      cookies** opens the link, sees read-only content, cannot mutate → owner
      revokes → link 404s. This single test demonstrates the whole product.

## Done when
The link works in incognito, exposes nothing above the share root, and dies on
revoke.
