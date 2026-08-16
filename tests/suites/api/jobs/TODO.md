# api/jobs

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/jobs/TODO.md`](../../../../apps/api/src/jobs/TODO.md)

Jobs became inspectable objects, which means the registry and the run lifecycle
are testable without waiting for a schedule to fire.

## Declared tests

### Registry and schedules

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-JOBS-001 | Every `JobDefinition` has a unique id and a valid cron expression | unit | P1 |
| API-JOBS-002 | A malformed cron expression crashes the app at boot, not at first fire | integration | P1 |
| API-JOBS-003 | Every job registers with `timezone: 'UTC'` | unit | P1 |
| API-JOBS-004 | A `JOBS_CRON_*` override replaces the registry default | integration | P1 |
| API-JOBS-005 | A disabled job still appears in `GET /jobs` with `nextRunAt: null` | integration | P1 |

### Run lifecycle and status

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-JOBS-006 | A run row is inserted as `running` before the handler is invoked | integration | P1 |
| API-JOBS-007 | A successful run ends `succeeded` with its result recorded | integration | P1 |
| API-JOBS-008 | A throwing job ends `failed` with the message recorded, and the app survives | integration | P1 |
| API-JOBS-009 | A job exceeding `timeoutMs` ends `timed_out` and its `AbortSignal` fires | integration | P1 |
| API-JOBS-010 | `onOverlap: 'skip'` records a `skipped` run and does not run the handler twice | integration | P1 |
| API-JOBS-011 | The startup sweep converts an orphaned `running` row to `interrupted` | integration | P1 |
| API-JOBS-012 | After the sweep, a previously orphaned `skip` job can run again | integration | P1 |
| API-JOBS-013 | RETIRED — advisory-lock multi-instance claim, dropped for single-instance scheduling. See jobs/TODO.md §5 | integration | P1 |
| API-JOBS-024 | A `running` row older than its `timeoutMs` is treated as dead and the job runs again without a restart | integration | P0 |
| API-JOBS-025 | An instance with the scheduler flag off registers no cron jobs but still serves reads and manual triggers | integration | P1 |

### Manual triggering and authorization

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-JOBS-014 | `POST /jobs/:id/run` returns 202 with an immediately queryable runId | integration | P1 |
| API-JOBS-015 | A manual run records `triggered_by_user_id` | security | P1 |
| API-JOBS-016 | A manual run works on a disabled job | integration | P1 |
| API-JOBS-017 | A non-admin gets 404 from every endpoint in this module | security | P0 |
| API-JOBS-018 | An anonymous caller gets 404, not 401 | security | P1 |

### Serialisation and job behaviour

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-JOBS-019 | `nextRunAt` serializes as an ISO string, not a Luxon object | integration | P1 |
| API-JOBS-020 | Every job is idempotent — running it twice leaves the same state | property | P1 |
| API-JOBS-021 | `reconcile-rollups` reports and repairs a deliberately corrupted counter | integration | P1 |
| API-JOBS-022 | `prune-job-runs` deletes runs older than 90 days and nothing newer | integration | P1 |
| API-JOBS-023 | Run history is append-then-update-once; no endpoint deletes a run | security | P1 |

## Notes
- API-JOBS-011 and API-JOBS-012 pair up. The orphan itself is harmless; the
  permanent skip it causes is the actual bug, and only the second test catches it.
- API-JOBS-020 is a property test over the registry: for each job, snapshot the
  database, run twice, compare. It is the assumption manual triggering rests on.
- API-JOBS-024 replaces API-JOBS-013 as the test that matters. With one
  instance there is no concurrent-run case left to assert; the live risk is a
  crashed run wedging an `onOverlap: 'skip'` job permanently, which is what 024
  covers and what 011/012 only cover at boot.
