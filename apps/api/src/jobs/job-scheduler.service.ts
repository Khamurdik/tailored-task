import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { APP_CONFIG, type AppConfig } from '../common';
import { JobRunner } from './job-runner.service';
import { JobRunsRepository } from './job-runs.repository';
import { JobRegistry } from './job.registry';
import type { JobDefinition } from './job.types';

/**
 * Registers the schedule, and sweeps whatever the last process left behind.
 *
 * `SchedulerRegistry.addCronJob` rather than `@Cron()` — the registry is the
 * source of truth for what runs and when, so a definition can be listed,
 * overridden per environment, and triggered by hand without duplicating its
 * handler.
 */
@Injectable()
export class JobScheduler implements OnModuleInit {
  private readonly logger = new Logger(JobScheduler.name);

  constructor(
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly runs: JobRunsRepository,
    private readonly scheduler: SchedulerRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    const definitions = this.registry.all().map((job) => this.withOverrides(job));

    // **Validate every expression before registering any of them.** A bad cron
    // string that throws at first fire is a 3am problem; the same string
    // crashing the boot is a deploy that fails loudly.
    for (const job of definitions) this.assertValidCron(job);

    /**
     * The startup sweep: every `running` row becomes `interrupted`.
     *
     * Only sound because the scheduler runs on exactly one instance — a booting
     * instance can safely assume any `running` row is its own corpse. With two,
     * it would corrupt the other's live runs, which is one of the two reasons
     * the advisory-lock design was dropped (`jobs/TODO.md` §5).
     *
     * It runs even when the scheduler is disabled, because a stuck row blocks
     * manual triggers too.
     */
    const swept = await this.runs.sweepInterrupted();
    if (swept > 0) this.logger.warn(`Marked ${swept} orphaned run(s) as interrupted`);

    if (!this.config.jobs.schedulerEnabled) {
      // Reads and manual triggers still work. This is the flag that makes
      // "exactly one instance schedules" a switch rather than a hope.
      this.logger.log('JOBS_SCHEDULER_ENABLED is false — no cron jobs registered');
      return;
    }

    for (const job of definitions) {
      if (!job.enabled) {
        // Registered nowhere, listed anyway. A disabled job still appears in
        // `GET /jobs` with `nextRunAt: null` — a job you cannot see is a job
        // you forget exists.
        this.logger.log(`Job "${job.id}" is disabled — listed but not scheduled`);
        continue;
      }

      const cronJob = CronJob.from({
        cronTime: job.cron,
        timeZone: job.timezone,
        onTick: () => {
          // Fire and forget: the runner records everything, and an exception
          // escaping a tick handler would be unhandled.
          void this.runner.run(job, { trigger: 'schedule' });
        },
      });

      this.scheduler.addCronJob(job.id, cronJob as never);
      cronJob.start();
    }
  }

  /**
   * The next fire time, as an **ISO string**.
   *
   * `@nestjs/schedule@6` depends on `cron@4`, which is Luxon-based:
   * `nextDate()` returns a Luxon `DateTime`, not a `Date`. Handing it to the
   * response serializer produces an object full of internal Luxon fields, and
   * `new Date(nextDate())` yields `Invalid Date`.
   */
  nextRunAt(job: JobDefinition): string | null {
    if (!job.enabled || !this.config.jobs.schedulerEnabled) return null;

    try {
      const cronJob = this.scheduler.getCronJob(job.id) as unknown as {
        nextDate: () => { toISO: () => string | null };
      };
      return cronJob.nextDate().toISO();
    } catch {
      // Not registered — the scheduler is off, or this instance never scheduled
      // it. Null is the honest answer rather than a guess.
      return null;
    }
  }

  /** The definition with any `JOBS_CRON_<ID>` override and `JOBS_DISABLED` applied. */
  withOverrides(job: JobDefinition): JobDefinition {
    const cron = this.config.jobs.cronOverrides[job.id];
    const disabled = this.config.jobs.disabled.includes(job.id);

    return {
      ...job,
      cron: cron ?? job.cron,
      enabled: job.enabled && !disabled,
    };
  }

  private assertValidCron(job: JobDefinition): void {
    try {
      CronJob.from({ cronTime: job.cron, timeZone: job.timezone, onTick: () => undefined }).stop();
    } catch (cause) {
      // The cause is attached as well as summarised: the message is what a
      // deploy log shows, and the original is what someone debugging needs.
      throw new Error(
        `Job "${job.id}" has an invalid cron expression ${JSON.stringify(job.cron)}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        { cause },
      );
    }
  }
}
