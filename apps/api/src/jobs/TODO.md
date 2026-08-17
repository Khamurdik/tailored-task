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
- [x] `JOBS: JobDefinition[]` in one file. Adding a job means adding one entry
- [x] Register each one at bootstrap via `SchedulerRegistry.addCronJob`, building
      the job with `CronJob.from({ cronTime, onTick, timeZone })`
- [x] **Pin `timezone: 'UTC'` explicitly.** Left unset, `cron` uses the process
      zone, so "daily at 02:00" silently means something different on a
      developer laptop than on App Runner, and shifts twice a year under DST
- [x] Cron expressions are overridable per environment through validated config
      (`JOBS_CRON_<ID>`), so a schedule can be changed without a deploy. The
      value in `JOBS` is the default, not the only option
- [x] `enabled: false` must still register and list the job, reporting
      `nextRunAt: null`. A job you cannot see is a job you forget exists
- [x] Validate every expression at boot and **crash on a malformed one**. A bad
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
- [x] Insert a `running` row **before** the handler is called, so a crash is
      still visible as an attempt rather than as nothing at all
- [x] Update to a terminal status in a `finally`, with `duration_ms` computed
      from the two timestamps rather than a stopwatch variable
- [x] Persist `result` on success and `error_message` / `error_stack` on failure.
      A failed run that records no reason is barely better than no record
- [x] **Startup sweep**: on boot, every `running` row becomes `interrupted`.
      This is only sound because the scheduler runs on exactly one instance
      (§5) — a booting instance can safely assume any `running` row is its own
      corpse. Without the sweep a crash leaves a permanently `running` row, and
      an `onOverlap: 'skip'` job then skips forever — the failure mode is a job
      that silently never runs again
- [x] The same rule applied outside boot needs the age test, not the blanket
      one: a run older than `timeoutMs` (floor: one hour) is dead. See §5
- [x] A job that throws must never take the process down. Catch at the runner

---

## 3. Manual triggering

- [x] `POST /jobs/:id/run` → **202 Accepted** `{ runId }`, executes
      asynchronously. Do not block the request on a job that may run for
      minutes; the caller polls the run
- [x] Reject with 409 `CONFLICT` when a run is already in flight and
      `onOverlap` is `reject`; record a `skipped` run when it is `skip`
- [x] `triggered_by_user_id` is always populated for manual runs. "Who ran the
      hard-delete?" must be answerable
- [x] Manual runs ignore `enabled: false` — disabling a schedule should not
      remove the ability to run it deliberately. Say so in the response
- [x] Throttle manual triggers; these are expensive operations. 10/minute
      against the global 120. **Keyed by IP, not by user** — `@nestjs/throttler`
      tracks by address and a per-user key would need a custom tracker. Stated
      rather than glossed: the practical difference is small when every caller
      is an operator, and it is not what the line originally asked for
- [x] `DELETE /jobs/runs/:runId` is **not** an endpoint. Runs are history

### Read endpoints
- [x] `GET /jobs` — every definition, plus `lastRun` summary and `nextRunAt`
- [x] `GET /jobs/:id` — one definition with its recent runs
- [x] `GET /jobs/:id/runs?cursor=` — keyset paginated history, reusing
      `common`'s cursor helpers rather than an offset
- [x] `GET /jobs/runs/:runId` — one run in full

> **`nextRunAt` is a Luxon `DateTime`, not a `Date`.** `@nestjs/schedule@6`
> depends on `cron@4`, whose `CronJob.nextDate()` returns Luxon. Serialize it
> with `.toISO()`; handing it straight to the response serializer produces an
> object full of internal Luxon fields, and `new Date(nextDate())` yields
> `Invalid Date`.

---

## 4. Authorization

These endpoints expose deletion counts across every room and can trigger a hard
delete. They are not node-scoped, so `access`'s `NodeAccessGuard` does not apply.

- [x] Guard with ~~`@RequireAuth()` **plus**~~ an `is_admin` check on the user row.
      **`@RequireAuth()` is deliberately not used**, and this is a correction to
      the spec: it throws **401**, which tells an unauthenticated caller that an
      admin surface exists here. `AdminGuard` answers 404 for anonymous,
      share-scoped, and merely-not-admin callers alike — one exit, constructed
      one way, exactly as the next line asks for. `API-JOBS-018` pins it
- [x] `is_admin` is a column on `users`, set by the seeder from `.env` — see
      `users/TODO.md`. There is no self-service path to it
- [x] A non-admin gets **404**, not 403, consistent with the rest of the system

---

## 5. Concurrency — one instance, enforced by the platform

**Decided: the scheduler runs on exactly one instance, and that is a deployment
constraint we accept rather than a problem we solve in application code.**

An earlier revision reached for `pg_try_advisory_lock(hashtext($jobId))` so the
runner would be correct on N instances. Two things are wrong with it here:

1. **It does not work on this stack.** A `pg_try_advisory_lock` is
   *session*-scoped and must be released on the same connection that took it.
   Prisma hands out pooled connections per query with no such guarantee, and
   Neon's pooled endpoint is PgBouncer in transaction mode, where session-level
   advisory locks do not hold at all. The lock would appear to work in dev
   against a direct connection and silently stop working in production.
2. **It contradicts §2.** The startup sweep marks any `running` row as
   `interrupted` on boot. With two instances, a booting instance cannot tell a
   crashed run from one that the other instance is legitimately executing, so
   it corrupts live runs. The sweep and multi-instance scheduling cannot both
   be correct without a heartbeat, and a heartbeat is more machinery than this
   earns.

- [ ] Pin the API service to a single instance (App Runner `minSize: 1`,
      `maxSize: 1`). One config value, and it is the thing actually being
      relied on. **Not done, because nothing is deployed** — this is the one
      item here that lives in infrastructure rather than in code, and it is the
      one the startup sweep's correctness actually rests on
- [x] Assert it at boot: if `JOBS_SCHEDULER_ENABLED` is true on more than one
      instance nothing detects it, so make the flag the switch. Instances that
      run with it false register no cron jobs and still serve the read and
      manual-trigger endpoints
- [x] Write the constraint into the README next to the deploy instructions. An
      undocumented "must not scale out" is a constraint that gets violated by
      someone who never knew about it

### The failure this leaves, and the guard for it

One instance removes the concurrent-run problem. It does not remove the problem
the advisory lock was *also* covering: a process that dies mid-run leaves a
`running` row forever, and an `onOverlap: 'skip'` job then skips forever — a job
that silently never runs again.

- [x] **Stale-run guard.** A `running` row whose `started_at` is older than its
      job's `timeoutMs` (floor: one hour) is treated as dead. The startup sweep
      applies it at boot; the runner applies it before claiming, so recovery does
      not require a restart
- [x] That guard is why this does not need alerting to be safe. `GET /jobs`
      showing `lastRun: interrupted` is the signal, and it costs nothing to
      build. Slack/Grafana alerting on "a run has been `running` for over an
      hour" is a genuinely good addition later, but it is monitoring on top of a
      system that already self-heals, not the mechanism that makes it correct

### If the service ever must scale out

The upgrade path is written down so nobody rediscovers it: use
`pg_advisory_xact_lock` inside the transaction that writes the run's terminal
status (transaction-scoped locks survive PgBouncer), and replace the startup
sweep with a heartbeat column the runner touches every few seconds.

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
- [x] Registry: every `JobDefinition` has a valid cron expression and a unique id
- [x] A job that throws produces a `failed` run with the message recorded, and
      the next scheduled fire still happens
- [x] A job exceeding `timeoutMs` produces `timed_out` and its `AbortSignal` fires
- [x] `onOverlap: 'skip'` — a second concurrent trigger records `skipped` and
      does not run the handler twice
- [x] Startup sweep converts an orphaned `running` row to `interrupted`
- [x] Manual trigger returns 202 with a runId that is immediately queryable
- [x] A non-admin gets 404 from every endpoint in this module
- [x] Reaper leaves non-stale pending nodes alone
- [x] `reconcile-rollups` reports and repairs a deliberately corrupted counter
- [x] A `running` row older than `timeoutMs` is treated as dead and the job
      runs again without a restart

## Implementation notes

- [x] **`cron` had to become a direct dependency.** The spec calls for
      `CronJob.from({ cronTime, onTick, timeZone })`, and `cron` is a transitive
      dependency of `@nestjs/schedule` — under pnpm's strict linking it is not
      resolvable from `apps/api`. Pinned to **exactly** `4.4.0`, the version
      `@nestjs/schedule@6.1.3` itself resolves: a different pin would put two
      copies of `CronJob` in the tree, and `SchedulerRegistry.addCronJob` would
      be handed an instance of the class it is not checking against.
- [x] **The startup sweep has to be one statement.** The first version used
      `updateMany` for the status and `finished_at`, then a second `UPDATE` for
      `duration_ms` — because `updateMany` cannot compute a per-row difference
      between two columns. It failed on `job_runs_duration_iff_finished`: the
      constraint is immediate, so the intermediate row is rejected and the
      second statement never runs. That is the constraint doing its job. A pair
      of writes only valid once both land is a pair that leaves invalid rows
      whenever the second does not, and "the sweep half-ran" is the exact state
      this table exists to make impossible.
- [x] **The `job_runs` migration nearly dropped a live index.** `migrate dev`
      generated `DROP INDEX "refresh_tokens_expires_at"` — the index
      `purge-expired-tokens` is built on — because that index was created by
      hand in `add_refresh_tokens` and never declared in `schema.prisma`, so
      Prisma read it as drift. The other hand-written indexes in this schema are
      partial or carry an operator class, which Prisma cannot represent and
      therefore leaves alone; this one was a plain btree. It is declared in the
      schema now and the migration renames rather than drops.
- [x] Run-history pagination uses a **plain, unsigned** base64url timestamp
      cursor, unlike the tree's signed one. The difference is deliberate: a tree
      cursor carries a *name*, so a forged one probes whether a name exists in a
      folder the caller cannot list. This carries a timestamp over a history the
      caller is already an admin for.

## Done when
`GET /jobs` lists all six with their next fire time and last outcome, any of
them can be triggered by hand and watched to completion, a deliberately broken
job shows `failed` with its reason instead of disappearing, and nothing
accumulates — no orphan objects, no zombie pending rows, no expired grants or
tokens, no unbounded run history.
