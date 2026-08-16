# web/shared

## Purpose
Everything more than one feature needs: the API client, error mapping, query
keys, and UI primitives.

## Owns
The HTTP client, the query-key factory, and the token store.

## Public surface
- `api` — typed client, parses responses against the shared schemas
- `tokenStore` — `get()`, `set(pair)`, `clear()`, `subscribe()`. The **only**
  code in the app that touches `localStorage`
- `queryKeys` — `nodes.children(id)`, `nodes.detail(id)`, `nodes.stats(id)`, `shares.list(id)`
- `useAppError` — maps `ErrorCode` to a message and a recovery action
- shadcn primitives, `<Icon>`, `<EmptyState>`, `<Skeleton>`, `<ConfirmDialog>`

## Depends on
`packages/shared`.

## Must not depend on
Any feature folder. Dependencies point inward only.

## Responsibilities
- [ ] Axios instance, `withCredentials: false` — this client sends no cookies
- [ ] Request interceptor attaching `Authorization: Bearer <accessToken>` from
      the token store
- [ ] Response interceptor: 401 → `POST /auth/refresh` with the refresh token
      **in the JSON body** → store the rotated pair → retry once
- [ ] **Single-flight refresh.** Concurrent 401s must await one refresh call and
      then all retry. Firing one refresh per in-flight request rotates the token
      N times, and every rotation after the first is a replay of an
      already-rotated token — which the server treats as theft and kills the
      whole family. The symptom is random logouts under a burst of parallel
      requests, and it will not reproduce on a slow single-request page
- [ ] A failed refresh clears the token store once and redirects to login —
      never loops
- [ ] Attach `X-Share-Token` automatically when the route is a share route
- [ ] Unwrap the `{ code, message, details }` envelope into a typed `AppError`
- [ ] `retry: false` for 404 and 410 — do not hammer a gone resource
- [ ] `refetchOnWindowFocus: true` globally. This is free pseudo-realtime and
      solves most of the stale-tree problem without websockets.
- [ ] Route-level error boundary rendering a real screen for 410 and 404

## Invariants
- Every mutation invalidates the `['nodes']` key prefix wholesale. Hand-crafting
  a precise invalidation graph for move and delete is where stale-UI bugs come
  from; over-invalidating is cheap and always correct.
- `localStorage` is read and written in exactly one file. Everything else goes
  through `tokenStore`, so the storage format can change without a search across
  features.
- The refresh token never appears in a URL, a query key, or a log line.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/web/shared/TODO.md`](../../../../tests/suites/web/shared/TODO.md) and implemented there — never in this module's folder.
- [ ] Ten simultaneous requests hitting 401 trigger exactly **one** refresh call
      and all ten succeed on retry

## Done when
An expired share link produces a designed screen, not a spinner or a toast, and
a burst of parallel requests after the access token expires recovers with a
single refresh rather than logging the user out.
