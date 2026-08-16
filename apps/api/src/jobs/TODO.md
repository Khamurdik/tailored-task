# jobs — L4

## Purpose
Scheduled background work, exposed as inspectable objects. Everything the
request path deliberately defers runs here, and every run leaves a record.

## Owns
- The job registry — the single source of truth for what runs and when
- `job_runs` table — one row per execution, with a terminal status

## Public surface
- `JobsController`: list jobs, read a job, list runs, read a run, trigger a run
- `JobRegistry.register(def)` — how a job is declared
- `JobDefinition`, `JobRun`, `JobStatus` types

Nothing imports this module. It reaches down; nothing reaches in.

## Depends on
`common`, `auth` (guards), `files`, `access`, `nodes`.

---

## 1. How a job is defined

One object per job, in one array. There are **no `@Cron()` decorators anywhere
in this module.** A decorator hard-codes its expression at a call site, which
means the schedule cannot be listed, overridden per environment, or triggered by
hand without duplicating the handler. Registering through `SchedulerRegistry`
keeps the definition addressable.

```ts
type JobId =
  | 'reap-pending-uploads'
  | 'hard-delete-expired'
  | 'purge-expired-grants'
  | 'purge-expired-tokens'
  | 'reconcile-rollups'
  | 'prune-job-runs';

interface JobDefinition {
  id: JobId;               // stable slug — appears in URLs and job_runs rows
  name: string;            // human label for the UI
  description: string;     // what it does and why, one sentence
  cron: string;            // 6-field expression, seconds first
  timezone: 'UTC';         // never the container's local zone
  enabled: boolean;        // config-driven; disabled jobs still list, never fire
  timeoutMs: number;       // exceeding this is a failure, not a hang
  onOverlap: 'skip' | 'reject';  // what a second concurrent run does
  run(ctx: JobContext): Promise<JobResult>;
}

interface JobContext {
  runId: string;
  trigger: 'schedule' | 'manual';
  signal: AbortSignal;     // aborted at timeoutMs; long loops must check it
  logger: Logger;
}

// Whatever the job wants to report. Ends up in job_runs.result as jsonb
// and is what makes a green run *informative* rather than merely green.
type JobResult = Record<string, number | string>;
```

### Responsibilities
- [ ] `JOBS: JobDefinition[]` in one file. Adding a job means adding one entry
- [ ] Register each one at bootstrap via `SchedulerRegistry.addCronJob`, building
      the job with `CronJob.from({ cronTime, onTick, timeZone })`
- [ ] **Pin `timezone: 'UTC'` explicitly.** Left unset, `cron` uses the process
      zone, so "daily at 02:00" silently means something different on a
      developer laptop than on App Runner, and shifts twice a year under DST
- [ ] Cron expressions are overridable per environment through validated config
      (`JOBS_CRON_<ID>`), so a schedule can be changed without a deploy. The
      value in `JOBS` is the default, not the only option
- [ ] `enabled: false` must still register and list the job, reporting
      `nextRunAt: null`. A job you cannot see is a job you forget exists
- [ ] Validate every expression at boot and **crash on a malformed one**. A bad
      cron string that throws at first fire is a 3am problem

---

## 2. Every run is a queryable object

### Schema — `job_runs`
`id`, `job_id`, `trigger` (`schedule` | `manual`), `triggered_by_user_id`
(null for scheduled), `status`, `started_at`, `finished_at`, `duration_ms`,
`result` jsonb, `error_message`, `error_stack`, `attempt`.

Index on `(job_id, started_at DESC)` — every read is "recent runs for this job".

### Status
```ts
type JobStatus =
  | 'running'      // claimed, in flight
  | 'succeeded'    // finished, no throw
  | 'failed'       // threw, or returned a rejected promise
  | 'timed_out'    // exceeded timeoutMs
  | 'skipped'      // an instance was already running, onOverlap: 'skip'
  | 'interrupted'; // the process died mid-run — set by the startup sweep
```

### Responsibilities
- [ ] Insert a `running` row **before** the handler is called, so a crash is
      still visible as an attempt rather than as nothing at all
- [ ] Update to a terminal status in a `finally`, with `duration_ms` computed
      from the two timestamps rather than a stopwatch variable
- [ ] Persist `result` on success and `error_message` / `error_stack` on failure.
      A failed run that records no reason is barely better than no record
- [ ] **Startup sweep**: on boot, any `running` row whose job is not actually in
      flight becomes `interrupted`. Without this a crash leaves a permanently
      `running` row, and an `onOverlap: 'skip'` job then skips forever — the
      failure mode is a job that silently never runs again
- [ ] A job that throws must never take the process down. Catch at the runner

---

## 3. Manual triggering

- [ ] `POST /jobs/:id/run` → **202 Accepted** `{ runId }`, executes
      asynchronously. Do not block the request on a job that may run for
      minutes; the caller polls the run
- [ ] Reject with 409 `CONFLICT` when a run is already in flight and
      `onOverlap` is `reject`; record a `skipped` run when it is `skip`
- [ ] `triggered_by_user_id` is always populated for manual runs. "Who ran the
      hard-delete?" must be answerable
- [ ] Manual runs ignore `enabled: false` — disabling a schedule should not
      remove the ability to run it deliberately. Say so in the response
- [ ] Throttle manual triggers per user; these are expensive operations
- [ ] `DELETE /jobs/runs/:runId` is **not** an endpoint. Runs are history

### Read endpoints
- [ ] `GET /jobs` — every definition, plus `lastRun` summary and `nextRunAt`
- [ ] `GET /jobs/:id` — one definition with its recent runs
- [ ] `GET /jobs/:id/runs?cursor=` — keyset paginated history, reusing
      `common`'s cursor helpers rather than an offset
- [ ] `GET /jobs/runs/:runId` — one run in full

> **`nextRunAt` is a Luxon `DateTime`, not a `Date`.** `@nestjs/schedule@6`
> depends on `cron@4`, whose `CronJob.nextDate()` returns Luxon. Serialize it
> with `.toISO()`; handing it straight to the response serializer produces an
> object full of internal Luxon fields, and `new Date(nextDate())` yields
> `Invalid Date`.

---

## 4. Authorization

These endpoints expose deletion counts across every room and can trigger a hard
delete. They are not node-scoped, so `access`'s `NodeAccessGuard` does not apply.

- [ ] Guard with `@RequireAuth()` **plus** an `is_admin` check on the user row
- [ ] `is_admin` is a column on `users`, set by the seeder from `.env` — see
      `users/TODO.md`. There is no self-service path to it
- [ ] A non-admin gets **404**, not 403, consistent with the rest of the system

---

## 5. Concurrency across instances

The original plan was "one instance only, which `minSize: 1` gives us free".
That is true today and silently false the first time the service scales out —
two instances would run `hard-delete-expired` simultaneously.

- [ ] Claim each run with a Postgres advisory lock:
      `pg_try_advisory_lock(hashtext($jobId))`, released in the same `finally`
      that writes the terminal status
- [ ] Failing to acquire the lock is a `skipped` run, not an error
- [ ] This makes the job runner correct on N instances, costs one query, and
      removes the deployment constraint entirely

---

## 6. The jobs themselves

| id | Schedule | Does | Reports |
| --- | --- | --- | --- |
| `reap-pending-uploads` | hourly | `files.reapPending(1h)` | `{ scanned, deleted }` |
| `hard-delete-expired` | daily | Hard-delete nodes soft-deleted > 30 days **and their S3 objects** — the only place an object is ever removed | `{ nodes, objects, bytes }` |
| `purge-expired-grants` | daily | Delete grants past `expires_at` or revoked > 30 days | `{ purged }` |
| `purge-expired-tokens` | daily | Delete `refresh_tokens` past expiry or in a revoked family | `{ purged }` |
| `reconcile-rollups` | daily | Compare `subtree_files` / `subtree_bytes` against a live prefix aggregate | `{ checked, drifted, repaired }` |
| `prune-job-runs` | weekly | Delete `job_runs` older than 90 days | `{ pruned }` |

`reconcile-rollups` is the one worth building carefully. Silent drift in
denormalized counters is the classic failure of that pattern, and a job whose
result is `{ drifted: 0 }` every day is the only evidence the counters are
trustworthy. Have it **repair** as well as report, and record both numbers —
a rising `repaired` count with a stable `drifted` count means something upstream
is broken and the job is papering over it.

`prune-job-runs` exists because this module has the same unbounded-growth
problem it was built to detect. A run history that grows forever is the
`audit_events` trap in miniature.

## Invariants
- Every job is idempotent and safe to run twice. Manual triggering makes this a
  hard requirement rather than a nicety.
- Every run reaches a terminal status. `running` is never a resting state.
- A job failure is contained: it never fails another job and never crashes the app.
- Handlers hold no state between runs. Everything they need arrives in `JobContext`.
- `job_runs` is append-then-update-once. No third write, no deletes outside
  `prune-job-runs`.

## Tests
- [ ] Registry: every `JobDefinition` has a valid cron expression and a unique id
- [ ] A job that throws produces a `failed` run with the message recorded, and
      the next scheduled fire still happens
- [ ] A job exceeding `timeoutMs` produces `timed_out` and its `AbortSignal` fires
- [ ] `onOverlap: 'skip'` — a second concurrent trigger records `skipped` and
      does not run the handler twice
- [ ] Startup sweep converts an orphaned `running` row to `interrupted`
- [ ] Manual trigger returns 202 with a runId that is immediately queryable
- [ ] A non-admin gets 404 from every endpoint in this module
- [ ] Reaper leaves non-stale pending nodes alone
- [ ] `reconcile-rollups` reports and repairs a deliberately corrupted counter
- [ ] Advisory lock: two runners started together produce one `succeeded` and
      one `skipped`

## Done when
`GET /jobs` lists all six with their next fire time and last outcome, any of
them can be triggered by hand and watched to completion, a deliberately broken
job shows `failed` with its reason instead of disappearing, and nothing
accumulates — no orphan objects, no zombie pending rows, no expired grants or
tokens, no unbounded run history.
