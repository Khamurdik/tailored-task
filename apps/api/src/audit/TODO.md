# audit — L4 · optional

## Purpose
Append-only record of who did what. A due-diligence data room genuinely needs
one, which makes it a cheap way to show domain understanding.

## Owns
`audit_events` table. Append only — no updates, no deletes.

## Public surface
None. This module is a listener; nothing imports it.

## Depends on
`common`. Receives everything else via events.

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

## Scaling note for the README
This table grows without bound and is write-heavy. Partition by month, retain
hot data online and archive the rest. Good material for the scaling section.

## Done when
An owner can see who opened their shared file and when.
