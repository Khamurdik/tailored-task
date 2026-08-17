import type { Logger } from '@nestjs/common';
import type { JobId, JobStatus, JobTrigger } from '@dataroom/shared';

/**
 * Whatever the job wants to report, and what makes a green run **informative**
 * rather than merely green.
 *
 * `{ drifted: 0 }` every day is the only evidence the rollup counters are
 * trustworthy. A run that records nothing is barely better than no record.
 */
export type JobResult = Record<string, number | string>;

export interface JobContext {
  runId: string;
  trigger: JobTrigger;
  /**
   * Aborted at `timeoutMs`. **Long loops must check it** — a signal nobody
   * reads makes the timeout a label on a run that is still consuming the
   * database.
   */
  signal: AbortSignal;
  logger: Logger;
}

/**
 * One object per job, in one array.
 *
 * There are **no `@Cron()` decorators anywhere in this module**, and the reason
 * is not style: a decorator hard-codes its expression at a call site, which
 * means the schedule cannot be listed, overridden per environment, or triggered
 * by hand without duplicating the handler. Registering through
 * `SchedulerRegistry` keeps the definition addressable — `GET /jobs` is just
 * this array plus its history.
 */
export interface JobDefinition {
  /** Stable slug. Appears in URLs and in every `job_runs` row. */
  id: JobId;
  name: string;
  description: string;
  /** Six fields, seconds first. Overridable per environment via `JOBS_CRON_<ID>`. */
  cron: string;
  /**
   * Never the container's local zone. Left unset, `cron` uses the process zone,
   * so "daily at 02:00" quietly means something different on a laptop than on
   * App Runner — and shifts twice a year under DST.
   */
  timezone: 'UTC';
  /** A disabled job still registers and still lists. A job you cannot see is a job you forget exists. */
  enabled: boolean;
  /** Exceeding this is a failure, not a hang. */
  timeoutMs: number;
  /** What a second concurrent run does. */
  onOverlap: 'skip' | 'reject';
  run(context: JobContext): Promise<JobResult>;
}

export interface JobRunRecord {
  id: string;
  jobId: string;
  trigger: JobTrigger;
  status: JobStatus;
  triggeredByUserId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  result: JobResult | null;
  errorMessage: string | null;
  attempt: number;
}

/**
 * The floor under a job's own `timeoutMs` when deciding a `running` row is dead.
 *
 * A job that declares a 30-second timeout should not have its runs declared
 * corpses 30 seconds in by an instance whose clock is a little ahead, so the
 * staleness test always allows at least an hour. This is the guard that stops a
 * crash mid-run wedging an `onOverlap: 'skip'` job forever.
 */
export const STALE_RUN_FLOOR_MS = 3_600_000;
