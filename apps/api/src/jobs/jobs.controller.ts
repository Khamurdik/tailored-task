import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  JobIdSchema,
  type JobDetail,
  type JobRunDetail,
  type JobRunSummary,
  type JobRunsPage,
  type JobSummary,
  type TriggerJobResponse,
} from '@dataroom/shared';

import { Actor, SessionGuard } from '../auth';
import { AppError, type RequestActor } from '../common';
import { AdminGuard } from './admin.guard';
import { JobRunner } from './job-runner.service';
import { JobRunsRepository } from './job-runs.repository';
import { JobRegistry } from './job.registry';
import { JobScheduler } from './job-scheduler.service';
import type { JobDefinition, JobRunRecord } from './job.types';

/**
 * Jobs as queryable objects.
 *
 * **There is no `DELETE /jobs/runs/:runId`**, and its absence is the design:
 * runs are history. The only path that removes one is `prune-job-runs`, on a
 * schedule, at ninety days.
 */
@Controller('jobs')
@UseGuards(SessionGuard, AdminGuard)
export class JobsController {
  constructor(
    private readonly registry: JobRegistry,
    private readonly scheduler: JobScheduler,
    private readonly runner: JobRunner,
    private readonly runs: JobRunsRepository,
  ) {}

  @Get()
  async list(): Promise<{ items: JobSummary[] }> {
    const items = await Promise.all(
      this.registry.all().map((job) => this.toSummary(this.scheduler.withOverrides(job))),
    );
    return { items };
  }

  /** Declared before `:id` so the literal segment is not swallowed by the parameter. */
  @Get('runs/:runId')
  async run(@Param('runId') runId: string): Promise<JobRunDetail> {
    const record = await this.runs.findById(runId);
    if (record === null) throw AppError.notFound();
    return toRunDetail(record);
  }

  @Get(':id')
  async detail(@Param('id') id: string): Promise<JobDetail> {
    const job = this.requireJob(id);
    const recent = await this.runs.listForJob(job.id, 20);

    return { ...(await this.toSummary(job)), recentRuns: recent.map(toRunSummary) };
  }

  /**
   * Keyset paginated on `started_at`, reusing the same ordering the index is
   * built for. An offset would drift as new runs arrive at the head, which for
   * a descending history is the common case rather than the rare one.
   */
  @Get(':id/runs')
  async runsFor(@Param('id') id: string, @Query('cursor') cursor?: string): Promise<JobRunsPage> {
    const job = this.requireJob(id);

    const before = cursor === undefined || cursor === '' ? undefined : decodeCursor(cursor);
    const limit = 50;
    const rows = await this.runs.listForJob(job.id, limit + 1, before);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);

    return {
      items: items.map(toRunSummary),
      nextCursor: hasMore && last !== undefined ? encodeCursor(last.startedAt) : null,
    };
  }

  /**
   * 202, with a `runId` the caller polls.
   *
   * Never blocking: these run for minutes, and a manual trigger that waits is a
   * gateway timeout with a job still running behind it.
   *
   * **A manual run ignores `enabled: false`.** Disabling a schedule should not
   * remove the ability to run something deliberately — that is exactly what an
   * operator disables a schedule in order to do.
   */
  @Post(':id/run')
  @HttpCode(202)
  // Tighter than the global limit: these are expensive, and one of them deletes
  // documents.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async trigger(@Param('id') id: string, @Actor() actor: RequestActor): Promise<TriggerJobResponse> {
    const job = this.scheduler.withOverrides(this.requireJob(id));

    // `AdminGuard` has already established a user actor.
    const triggeredByUserId = actor !== null && 'userId' in actor ? actor.userId : null;

    const record = await this.runner.run(job, { trigger: 'manual', triggeredByUserId });
    return { runId: record.id };
  }

  private requireJob(id: string): JobDefinition {
    // Validated against the registry rather than a schema, so an unknown id is
    // a 404 like any other missing thing.
    const parsed = JobIdSchema.safeParse(id);
    const job = parsed.success ? this.registry.find(parsed.data) : null;
    if (job === null) throw AppError.notFound();
    return job;
  }

  private async toSummary(job: JobDefinition): Promise<JobSummary> {
    const last = await this.runs.lastRun(job.id);

    return {
      id: job.id,
      name: job.name,
      description: job.description,
      cron: job.cron,
      timezone: job.timezone,
      enabled: job.enabled,
      timeoutMs: job.timeoutMs,
      onOverlap: job.onOverlap,
      nextRunAt: this.scheduler.nextRunAt(job),
      lastRun: last === null ? null : toRunSummary(last),
    };
  }
}

function toRunSummary(run: JobRunRecord): JobRunSummary {
  return {
    id: run.id,
    jobId: run.jobId as JobRunSummary['jobId'],
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
  };
}

/**
 * `errorStack` is on the row and **deliberately not here**. A stack names
 * internal paths and library versions; these endpoints exist to tell an admin
 * what failed, not to hand out a map of the deployment.
 */
function toRunDetail(run: JobRunRecord): JobRunDetail {
  return {
    ...toRunSummary(run),
    triggeredByUserId: run.triggeredByUserId,
    result: run.result,
    errorMessage: run.errorMessage,
    attempt: run.attempt,
  };
}

/**
 * A plain base64url timestamp, unsigned — unlike the tree's cursor.
 *
 * The difference is deliberate. A tree cursor carries a *name*, so a forged one
 * probes whether a name exists in a folder the caller cannot list. This carries
 * a timestamp, over a history the caller is already an admin for, so there is
 * nothing to learn by crafting one.
 */
function encodeCursor(startedAt: Date): string {
  return Buffer.from(startedAt.toISOString(), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Date {
  const decoded = new Date(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (Number.isNaN(decoded.getTime())) {
    throw AppError.validationFailed({ cursor: 'That page position is not valid' });
  }
  return decoded;
}
