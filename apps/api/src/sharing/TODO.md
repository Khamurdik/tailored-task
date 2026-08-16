# sharing — L3

## Purpose
The use-cases around grants: issue a public link, invite a user, list who has
access, revoke. Wraps `access`'s repository with policy and HTTP.

## Owns
Nothing. All state belongs to `access`.

## Public surface
- `SharingController`: create, list, revoke
- `SharingService.revokeSubtree(nodeIds)` — called on cascade delete

## Depends on
`common`, `access`, `users`, `nodes` (read only, to display names).

Does **not** depend on `auth`. The login-time claim is driven by an event
`auth` emits (`user.authenticated`), not by `auth` calling into this module —
otherwise L2 would depend on L3.

## Must not depend on
`files`. Sharing a file and uploading a file are unrelated concerns.

## Responsibilities
- [ ] `POST /nodes/:id/shares` — guarded by `@RequireAccess('own')`
- [ ] Public link: 32 CSPRNG bytes, base64url; store **SHA-256 of the token**,
      return the plaintext exactly once
- [ ] User grant: by email. If no account exists yet, store `principal_email`
      and bind when that user is provisioned. Without this, "share with a
      colleague" only works for people an operator has already seeded.
- [ ] **Binding a pending grant — two triggers, not one.** There is no
      registration, so users appear via the seeder or a manual `INSERT`:
  - [ ] Listener on `user.created` (emitted by the seeder) — the fast path
  - [ ] Claim on successful login, matching `principal_email` to the actor's
        email — the guarantee. A row inserted by raw SQL emits no event, so the
        listener alone would leave those grants pending forever
  - [ ] Both go through one `claimPendingGrants(userId, email)` method, so the
        two paths cannot drift
- [ ] `GET /nodes/:id/shares` — grants on this node **and** inherited ones,
      visibly distinguished, so the owner can see why something is exposed
- [ ] `DELETE /shares/:id` — sets `revoked_at`; effective immediately
- [ ] Listener on `node.deleted` → `revokeSubtree`
- [ ] Optional: expiry date, link password

## Invariants
- The plaintext token exists in exactly one response and is never logged.
- The share page sets `Referrer-Policy: no-referrer`. Without it the token
  leaks in the `Referer` header of any third-party request from that page.
- Revoking a grant does not invalidate already-issued presigned S3 URLs. The
  60-second TTL bounds it. Document this rather than hiding it.

## Move semantics — decide and write down
Moving a node **into** a shared folder silently exposes it. Moving it **out**
silently revokes inherited access. Both follow correctly from ancestor
resolution, and both surprise users.

Chosen behaviour: inheritance follows the tree, and the move dialog warns when
the destination is shared. A direct grant on the node itself survives a move.
State this in the README — reviewers poke at exactly this.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/sharing/TODO.md`](../../../../tests/suites/api/sharing/TODO.md) and implemented there — never in this module's folder.
- [ ] Create link → access anonymously → revoke → 404, same test
- [ ] **Scoping**: a grant on folder B, then request sibling folder C's id with
      B's token → 404 (not 403, not 200)
- [ ] Cascade delete of a parent revokes grants on descendants
- [ ] Invite an email with no user row, seed that user, grant becomes active
- [ ] Invite an email with no user row, insert that user with **raw SQL**, then
      log in — the grant binds on login even though no event fired
- [ ] The stored token is not the token that was returned

## Done when
A link created in one browser opens in a fresh incognito context, shows
read-only content, and dies the instant it is revoked.
