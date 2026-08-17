import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { JobId, JobStatus, JobTrigger } from '@dataroom/shared';

import { PrismaService } from '../common';
import type { JobResult, JobRunRecord } from './job.types';

/**
 * The only code that reads or writes `job_runs`.
 *
 * The table is **append-then-update-once**: one insert when a run is claimed,
 * one update when it reaches a terminal status, and no third write. Nothing here
 * offers a general `update`, because a run that can be edited is a history that
 * can be rewritten — and `prune-job-runs` is the only deletion path.
 */
@Injectable()
export class JobRunsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Claims a run by inserting it as `running` **before** the handler is called.
   *
   * That order is the whole point: a crash inside the handler is then visible as
   * an interrupted attempt rather than as nothing at all. Inserting afterwards
   * would make the runs you most need to see the ones that never get recorded.
   */
  async start(input: {
    jobId: JobId;
    trigger: JobTrigger;
    triggeredByUserId?: string | null;
    attempt?: number;
  }): Promise<JobRunRecord> {
    const row = await this.prisma.jobRun.create({
      data: {
        jobId: input.jobId,
        trigger: input.trigger,
        triggeredByUserId: input.triggeredByUserId ?? null,
        attempt: input.attempt ?? 1,
      },
    });
    return toRecord(row);
  }

  /**
   * Writes the terminal status, with `duration_ms` **derived from the
   * timestamps** rather than from a stopwatch the caller kept.
   *
   * Two clocks that can disagree is one clock too many: a duration measured in
   * JS and timestamps written by Postgres drift under load, and the row is then
   * internally inconsistent in a way nothing detects.
   */
  async finish(input: {
    id: string;
    status: Exclude<JobStatus, 'running'>;
    result?: JobResult | null;
    error?: unknown;
  }): Promise<JobRunRecord> {
    const started = await this.prisma.jobRun.findUniqueOrThrow({
      where: { id: input.id },
      select: { startedAt: true },
    });

    const finishedAt = new Date();

    const row = await this.prisma.jobRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - started.startedAt.getTime()),
        result: (input.result ?? undefined) as Prisma.InputJsonValue | undefined,
        errorMessage: messageOf(input.error),
        errorStack: stackOf(input.error),
      },
    });

    return toRecord(row);
  }

  /**
   * Records a run that never happened.
   *
   * A `skipped` row is not noise — it is the difference between "the job did not
   * run because another copy was already running" and "the job did not run and
   * nobody knows why". Written as one insert with its terminal status already
   * set, so it does not pass through `running`.
   */
  async recordSkipped(input: {
    jobId: JobId;
    trigger: JobTrigger;
    triggeredByUserId?: string | null;
  }): Promise<JobRunRecord> {
    const now = new Date();
    const row = await this.prisma.jobRun.create({
      data: {
        jobId: input.jobId,
        trigger: input.trigger,
        triggeredByUserId: input.triggeredByUserId ?? null,
        status: 'skipped',
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
      },
    });
    return toRecord(row);
  }

  /**
   * A live run for this job, if one is not already dead.
   *
   * `staleBefore` is what makes this a *guard* rather than a lock. A process
   * that dies mid-run leaves a permanently `running` row, and an
   * `onOverlap: 'skip'` job then skips forever — the failure mode is a job that
   * silently never runs again. A `running` row older than its job's timeout is
   * treated as a corpse, so recovery does not require a restart.
   */
  async findLiveRun(jobId: JobId, staleBefore: Date): Promise<JobRunRecord | null> {
    const row = await this.prisma.jobRun.findFirst({
      where: { jobId, status: 'running', startedAt: { gte: staleBefore } },
      orderBy: { startedAt: 'desc' },
    });
    return row === null ? null : toRecord(row);
  }

  /**
   * The startup sweep: every `running` row becomes `interrupted`.
   *
   * **Only sound because the scheduler runs on exactly one instance.** A booting
   * instance can safely assume any `running` row is its own corpse; with two
   * instances it would corrupt the other one's live runs, which is one of the
   * two reasons the advisory-lock design was dropped (`jobs/TODO.md` §5).
   */
  async sweepInterrupted(olderThan?: Date): Promise<number> {
    /**
     * **One statement, and it has to be.**
     *
     * The first version used `updateMany` to set the status and `finished_at`,
     * then a second `UPDATE` to fill `duration_ms` — because `updateMany` cannot
     * compute a per-row difference between two columns. It failed on
     * `job_runs_duration_iff_finished`: the constraint is immediate, so the
     * intermediate row (finished, with no duration) is rejected at the first
     * statement and the second never runs.
     *
     * That is the constraint doing exactly what it was added for. A pair of
     * writes that is only valid once both have landed is a pair that leaves
     * invalid rows whenever the second one does not, and "the sweep half-ran"
     * is precisely the state this table exists to make impossible.
     */
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "job_runs"
         SET "status" = 'interrupted',
             "finished_at" = now(),
             "duration_ms" = GREATEST(0, (EXTRACT(EPOCH FROM (now() - "started_at")) * 1000)::int),
             "error_message" = 'The process died while this run was in flight'
       WHERE "status" = 'running'
         AND (${olderThan ?? null}::timestamptz IS NULL OR "started_at" < ${olderThan ?? null}::timestamptz)
      RETURNING "id"
    `;

    return rows.length;
  }

  async findById(id: string): Promise<JobRunRecord | null> {
    const row = await this.prisma.jobRun.findUnique({ where: { id } });
    return row === null ? null : toRecord(row);
  }

  async lastRun(jobId: JobId): Promise<JobRunRecord | null> {
    const row = await this.prisma.jobRun.findFirst({
      where: { jobId },
      orderBy: { startedAt: 'desc' },
    });
    return row === null ? null : toRecord(row);
  }

  /** Newest first, matching `(job_id, started_at DESC)` exactly. */
  async listForJob(jobId: JobId, limit: number, before?: Date): Promise<JobRunRecord[]> {
    const rows = await this.prisma.jobRun.findMany({
      where: { jobId, ...(before === undefined ? {} : { startedAt: { lt: before } }) },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
    return rows.map(toRecord);
  }

  /**
   * The only deletion path in this module, and it exists because this module has
   * the same unbounded-growth problem it was built to detect.
   */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.jobRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
    return result.count;
  }
}

function toRecord(row: {
  id: string;
  jobId: string;
  trigger: JobTrigger;
  status: JobStatus;
  triggeredByUserId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  result: unknown;
  errorMessage: string | null;
  attempt: number;
}): JobRunRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    trigger: row.trigger,
    status: row.status,
    triggeredByUserId: row.triggeredByUserId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    result: (row.result ?? null) as JobResult | null,
    errorMessage: row.errorMessage,
    attempt: row.attempt,
  };
}

/** The message reaches the client; the stack does not. */
function messageOf(error: unknown): string | null {
  if (error === undefined || error === null) return null;
  return error instanceof Error ? error.message : String(error);
}

function stackOf(error: unknown): string | null {
  return error instanceof Error ? (error.stack ?? null) : null;
}
