# web/features/auth

## Purpose
Login, registration, session bootstrap, route protection.

## Owns
Client session state.

## Public surface
- `<ProtectedRoute>`
- `useSession()` → `{ user, isLoading }`

## Depends on
`shared`.

## Responsibilities
- [ ] Login and register forms, `react-hook-form` + the shared zod schemas
- [ ] Bootstrap: call `/me` once on mount, render nothing until it settles —
      a flash of the login screen for an authenticated user looks broken
- [ ] Redirect to the originally requested URL after login, not to the root
- [ ] Field-level errors from the API mapped to the right inputs
- [ ] Logout clears the query cache entirely

## Invariants
- `ProtectedRoute` gates owner routes only. `/s/:token` must stay reachable
  while logged out — this is the single most common way the public share flow
  gets accidentally broken.

## Done when
Refreshing the page keeps you logged in, and an anonymous visit to a share link
never touches a login screen.
