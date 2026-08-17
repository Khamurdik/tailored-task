# sharing — L3

## Purpose
The use-cases around grants: issue a public link, invite a user, list who has
access, revoke. Wraps `access`'s repository with policy and HTTP.

## Owns
Nothing. All state belongs to `access`.

## Public surface
- `SharingController`: create, list, revoke — **every route owner-authenticated,
  with no exceptions.** The anonymous side of sharing is
  [`links`](../links/TODO.md), which is a separate module precisely so that
  sentence can be asserted rather than assumed
- `SharingService.revokeSubtree(nodeIds)` — called on cascade delete

## Depends on
`common`, `access`, `users`, `nodes` (read only, to display names).

Minting is **not** done here. `access` issues the credentials along with the
grant row (`ShareCodec`), so this module never touches randomness and cannot
drift from the format [`links`](../links/TODO.md) has to parse.

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
- [ ] **Binding a pending grant — one trigger.** Claim on successful login,
      matching `principal_email` to the actor's email, through a single
      `claimPendingGrants(userId, email)` method.
  - [ ] It must be idempotent: it runs on *every* login, not just the first
  - [ ] An earlier revision specified two triggers, with a `user.created`
        listener as a fast path and login as the guarantee. The fast path was
        removed once it turned out the seeder is a separate process from the
        API and an in-process event could never reach this listener — and a
        hand-written `INSERT` emits nothing either. There was never a second
        path to drift from. See HANDOFF.md §3.13
  - [ ] The cost is honest and worth stating: a grant addressed to someone who
        has not logged in since being provisioned stays pending until they do.
        Nothing is lost, and nothing is visible to them in the meantime
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
- [ ] Invite an email with no user row, seed that user, then log in — the grant
      becomes active at login, not at seed time
- [ ] Invite an email with no user row, insert that user with **raw SQL**, then
      log in — the grant binds identically, because there is only one path
- [ ] The stored token is not the token that was returned

## Done when
A link created in one browser opens in a fresh incognito context, shows
read-only content, and dies the instant it is revoked.
