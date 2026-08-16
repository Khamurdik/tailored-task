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
- [ ] Read the credential out of the route (`/s/:code`) and send it as
      `X-Share-Token` — **never as a query parameter and never in a path the API
      sees**, so it cannot land in a server access log
- [ ] Resolve it via `GET /shares/resolve` → `{ rootNodeId, role, expiresAt }`,
      then fetch `GET /nodes/:rootNodeId` with the same header for the name and
      the children. Two requests, deliberately: the API declines to inline a
      node summary into the resolve response so that every fact a visitor learns
      about the tree has passed through `NodeAccessGuard`. See
      [`links/TODO.md`](../../../../api/src/links/TODO.md)
- [ ] The route accepts both credential spellings — a 43-char token and a
      16-char short code are the same route and the same code path
- [ ] Render `<Explorer readOnly />` scoped to that root
- [ ] Breadcrumbs stop at the share root — never reveal ancestors above it
- [ ] Minimal header: item name, "Shared with you", no account menu
- [ ] `Referrer-Policy: no-referrer` on this route
- [ ] **One screen for every failure** — invalid, revoked, expired, deleted, and
      never-existed all render the same thing. See below
- [ ] If the visitor happens to be signed in, still show the read-only view —
      do not silently upgrade them into the owner UI

## One failure screen, not four

**Decided: one screen.** A token that is invalid, revoked, expired, pointed at a
deleted node, or never existed all produce the same response and the same
rendering. The API returns one status and one body for all of them.

This follows directly from the rule the rest of the system is built on —
*denial is 404, never 403* (`docs/ARCHITECTURE.md`) — and from `API-ACCESS-011`,
which requires a denied request and a nonexistent id to be **byte-identical**.
Four screens break that on the one route untrusted people actually reach:

- "This link has expired" and "This link was revoked" both confirm the token was
  real, which turns the share endpoint into an oracle for guessed tokens.
- "Revoked" additionally leaks a fact about the owner's behaviour — that someone
  looked at the sharing settings and shut this link down — to whoever holds the
  link, including the person it was taken from.

### The alternative, and who gets to choose it

Four distinct screens are better product design. A recipient who is told "this
link expired on 3 March" knows to ask for a new one; a recipient shown one
generic screen files a support ticket, or assumes the sender made a mistake.
That cost is real and falls on legitimate users, while the security cost falls
on an attacker who has to guess tokens — 32 CSPRNG bytes, so guessing is not a
practical attack in the first place.

**This is a product decision, not an engineering one, and it must not be made by
whoever implements the screen.** If the four-screen version is wanted:

- [ ] Get it in writing from the product owner — an email, not a chat message,
      naming the four states and accepting that each one confirms a token
      existed. A data room is a legal-discovery product; "who decided the
      system would confirm the existence of a revoked link, and when" is a
      question that can be asked later, and the answer needs a date on it
- [ ] Link that email from this file and from the README
- [ ] Only then change `WEB-PUBLICVIEW-006` from `RETIRED` back to live

Until that email exists, one screen.

## Invariants
- **Nothing in this route may reuse an owner-scoped query key.** Sharing a
  cache entry between the owner view and the share view is the mechanism by
  which private data leaks into a public page. Namespace the keys by token.
- This route never redirects to login.
- Every failure on this route is indistinguishable from every other failure,
  in status, body, and rendering.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/public-view/TODO.md`](../../../../../tests/suites/web/public-view/TODO.md) and implemented there — never in this module's folder.
- [ ] Playwright: owner uploads → shares → **second browser context with no
      cookies** opens the link, sees read-only content, cannot mutate → owner
      revokes → link 404s. This single test demonstrates the whole product.

## Done when
The link works in incognito, exposes nothing above the share root, and dies on
revoke.
