import { CronJob } from 'cron';
import { describe, expect, it } from 'vitest';

import { JobRegistry } from '@api/jobs';

/**
 * The registry, checked without booting anything.
 *
 * These are the two properties that must hold for the *list* to be trustworthy,
 * independently of whether any job ever runs. Both are cheap and both fail
 * loudly at boot, which is the point: a bad cron expression that throws at first
 * fire is a 3am problem.
 */

/**
 * Constructed with no collaborators. Every definition closes over injected
 * services, but nothing here calls a handler — the shape of the registry is
 * knowable without a database, and keeping it that way is what makes this a unit
 * test rather than a boot.
 */
const registry = new JobRegistry(
  null as never,
  null as never,
  null as never,
  null as never,
  null as never,
);

describe('the job registry', () => {
  it('API-JOBS-001 every job has a unique id and a valid cron expression', () => {
    const jobs = registry.all();

    expect(jobs.length).toBeGreaterThan(0);
    expect(new Set(jobs.map((job) => job.id)).size, 'ids are unique').toBe(jobs.length);

    for (const job of jobs) {
      // Parsed by the same library that will schedule it, rather than by a
      // regular expression that agrees with it most of the time.
      expect(
        () => CronJob.from({ cronTime: job.cron, timeZone: job.timezone, onTick: () => undefined }).stop(),
        `${job.id}: ${job.cron}`,
      ).not.toThrow();

      // Six fields, seconds first. A five-field expression parses happily and
      // means something an hour or a day different from what was intended.
      expect(job.cron.trim().split(/\s+/), `${job.id} field count`).toHaveLength(6);

      expect(job.timeoutMs, `${job.id} timeout`).toBeGreaterThan(0);
      expect(job.name.length, `${job.id} name`).toBeGreaterThan(0);
      expect(job.description.length, `${job.id} description`).toBeGreaterThan(0);
    }
  });

  it('API-JOBS-003 every job registers with timezone UTC', () => {
    for (const job of registry.all()) {
      /**
       * Left unset, `cron` uses the process zone — so "daily at 02:00" quietly
       * means something different on a developer laptop than on App Runner, and
       * shifts twice a year under DST. Pinned explicitly on every definition,
       * and asserted rather than trusted because the failure is invisible
       * locally.
       */
      expect(job.timezone, job.id).toBe('UTC');
    }
  });
});
