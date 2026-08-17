import { Injectable, Logger } from '@nestjs/common';
import type { JobTrigger } from '@dataroom/shared';

import { AppError } from '../common';
import { JobRunsRepository } from './job-runs.repository';
import { STALE_RUN_FLOOR_MS, type JobDefinition, type JobResult, type JobRunRecord } from './job.types';

/**
 * Runs a job and guarantees it leaves a record.
 *
 * The contract this file exists to keep is one sentence: **every run reaches a
 * terminal status.** Everything below is in service of it — the row is inserted
 * before the handler, the status is written in a `finally`, and the two
 * situations where that is not enough (a process that dies, and a job that
 * hangs) are covered by the startup sweep and the stale-run guard.
 */
@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);

  constructor(private readonly runs: JobRunsRepository) {}

  /**
   * Claims and executes a job, or records why it did not.
   *
   * Returns the run record either way — including for a `skipped` run, because
   * "the job did not run because another copy was already running" is a fact the
   * caller asked for and a fact worth keeping.
   */
  async run(
    job: JobDefinition,
    options: { trigger: JobTrigger; triggeredByUserId?: string | null },
  ): Promise<JobRunRecord> {
    /**
     * The staleness cutoff. A `running` row older than the job's own timeout —
     * or an hour, whichever is longer — is a corpse rather than a live run.
     *
     * The floor matters: a job declaring a 30-second timeout should not have its
     * runs declared dead 30 seconds in by an instance whose clock is slightly
     * ahead.
     */
    const staleBefore = new Date(Date.now() - Math.max(job.timeoutMs, STALE_RUN_FLOOR_MS));
    const live = await this.runs.findLiveRun(job.id, staleBefore);

    if (live !== null) {
      if (job.onOverlap === 'reject') {
        // 409 rather than a queued run: the caller asked for it to happen now,
        // and it is not going to.
        throw AppError.conflict(`A run of "${job.id}" is already in flight`);
      }
      return this.runs.recordSkipped({
        jobId: job.id,
        trigger: options.trigger,
        triggeredByUserId: options.triggeredByUserId ?? null,
      });
    }

    // Inserted **before** the handler, so a crash inside it is visible as an
    // attempt rather than as nothing at all.
    const run = await this.runs.start({
      jobId: job.id,
      trigger: options.trigger,
      triggeredByUserId: options.triggeredByUserId ?? null,
    });

    void this.execute(job, run);
    return run;
  }

  /**
   * The handler, its timeout, and the terminal write.
   *
   * Deliberately **not awaited** by `run`: `POST /jobs/:id/run` answers 202 and
   * the caller polls, because blocking a request on a job that may take half an
   * hour is how a manual trigger becomes a gateway timeout.
   */
  private async execute(job: JobDefinition, run: JobRunRecord): Promise<void> {
    const controller = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      // The signal is the *cooperative* half. A handler that never checks it
      // keeps running — which is why exceeding the timeout is recorded as a
      // failure of the run rather than treated as having stopped it.
      controller.abort();
    }, job.timeoutMs);

    try {
      const result = await Promise.race([
        job.run({
          runId: run.id,
          trigger: run.trigger,
          signal: controller.signal,
          logger: new Logger(`job:${job.id}`),
        }),
        timeoutRace(controller.signal),
      ]);

      await this.runs.finish({ id: run.id, status: 'succeeded', result: result as JobResult });
    } catch (cause) {
      /**
       * **A job that throws must never take the process down**, and never fail
       * another job. Caught here, recorded, and swallowed — the record is the
       * report.
       */
      const status = timedOut ? 'timed_out' : 'failed';
      this.logger.error(
        `Job "${job.id}" ${status}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );

      await this.runs
        .finish({ id: run.id, status, error: cause })
        .catch((writeFailure: unknown) => {
          // If even the terminal write fails, the row stays `running` and the
          // stale-run guard collects it. Logged so the cause is not invisible.
          this.logger.error(`Could not record the outcome of run ${run.id}: ${String(writeFailure)}`);
        });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Rejects when the run is aborted, so a hung handler still reaches a status. */
function timeoutRace(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(new Error('The job exceeded its timeout'));
      },
      { once: true },
    );
  });
}
