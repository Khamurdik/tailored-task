# audit — L4 · DEFERRED — do not implement

> **Status: not in scope.** Third priority, behind everything in `sharing`,
> `files`, and the web app. Do not start this module. Do not add an
> `audit_events` table, and do not emit events "for later" — an unread event
> stream is maintenance cost with no payoff.
>
> This file stays in the repo as a design note, so the decision is visible and
> the module can be picked up later without rediscovering it.

## Why it is deferred, not cut

A due-diligence data room genuinely wants an audit trail, so this is worth
building eventually. It is deferred rather than deleted because nothing else
depends on it: `audit` is a pure listener, so adding it later touches no
existing module. That property is exactly what makes it safe to postpone.

## Ordering

Priority behind the two other optional modules:

1. Everything in the core path (`common` → … → `web/public-view`)
2. `jobs`, then `search`
3. **`audit`** — this module

If time runs out, this is the correct thing to be missing.

## When it is picked up — the sketch

## Purpose
Append-only record of who did what.

## Owns
`audit_events` table. Append only — no updates, no deletes.

## Public surface
None. This module is a listener; nothing imports it.

## Depends on
`common`, plus `access` for the one guarded read endpoint.

## Responsibilities
- [ ] Schema: `id`, `actor_id`, `actor_kind` (`user` | `share_token`),
      `node_id`, `action`, `metadata` jsonb, `ip`, `created_at`
- [ ] Listen for `node.created`, `node.moved`, `node.deleted`, `share.created`,
      `share.revoked`, `file.viewed`
- [ ] `GET /nodes/:id/activity` — owner only, subtree-scoped via path prefix
- [ ] Write asynchronously; a failure here must never fail the user's request

## Invariants
- No module imports `audit`. It subscribes; it is never called.
- Audit failures are logged and swallowed.

## Note for whoever picks this up
The "depends on `common` only" line above is not quite true, and the original
version of this file claimed it was: `GET /nodes/:id/activity` is owner-only,
which needs `access`'s guard. Either accept the `access` dependency or drop the
read endpoint and query the table directly. Decide before writing code.

## Scaling note for the README
This table grows without bound and is write-heavy. Partition by month, retain
hot data online and archive the rest.
