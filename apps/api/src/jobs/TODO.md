# jobs — L4

## Purpose
Scheduled cleanup. Everything the request path deliberately defers.

## Owns
Schedules only.

## Public surface
None.

## Depends on
`common`, `files`, `access`, `nodes`.

## Responsibilities
- [ ] `@nestjs/schedule`
- [ ] Hourly: `files.reapPending(1h)`
- [ ] Daily: hard-delete nodes soft-deleted more than 30 days ago, and their
      S3 objects — the only place objects are ever removed
- [ ] Daily: purge expired grants
- [ ] Daily: reconcile rollup counters against a live prefix aggregate and log
      any drift. Silent drift in denormalized counters is the classic failure
      of this pattern; measuring it is how you find out.

## Invariants
- Every job is idempotent and safe to run twice.
- Jobs run on one instance only. With `minSize: 1` on App Runner this is free;
  note in the README that a real deployment needs a lock or a dedicated worker.

## Tests
- [ ] Reaper leaves non-stale pending nodes alone
- [ ] Reconciliation reports a deliberately corrupted counter

## Done when
Nothing accumulates: no orphan objects, no zombie pending rows, no expired
grants in the table.
