# web/shared

## Purpose
Everything more than one feature needs: the API client, error mapping, query
keys, and UI primitives.

## Owns
The HTTP client and the query-key factory.

## Public surface
- `api` — typed client, parses responses against the shared schemas
- `queryKeys` — `nodes.children(id)`, `nodes.detail(id)`, `nodes.stats(id)`, `shares.list(id)`
- `useAppError` — maps `ErrorCode` to a message and a recovery action
- shadcn primitives, `<Icon>`, `<EmptyState>`, `<Skeleton>`, `<ConfirmDialog>`

## Depends on
`packages/shared`.

## Must not depend on
Any feature folder. Dependencies point inward only.

## Responsibilities
- [ ] Axios instance with a 401 → refresh → retry-once interceptor
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

## Done when
An expired share link produces a designed screen, not a spinner or a toast.
