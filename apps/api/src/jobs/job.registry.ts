import { Injectable } from '@nestjs/common';
import type { JobId } from '@dataroom/shared';

import { SharesRepository } from '../access';
import { RefreshTokenRepository } from '../auth';
import { FilesService } from '../files';
import { NodesService } from '../nodes';
import { JobRunsRepository } from './job-runs.repository';
import type { JobDefinition } from './job.types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The six jobs, in one array.
 *
 * Adding a job means adding one entry. There are no `@Cron()` decorators
 * anywhere in this module — see `JobDefinition`.
 *
 * Every one of these is **idempotent and safe to run twice**, which is a hard
 * requirement rather than a nicety: `POST /jobs/:id/run` exists, so a human can
 * and will run them back to back.
 */
@Injectable()
export class JobRegistry {
  constructor(
    private readonly files: FilesService,
    private readonly nodes: NodesService,
    private readonly shares: SharesRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly runs: JobRunsRepository,
  ) {}

  /** Built on demand so each definition closes over the injected services. */
  all(): JobDefinition[] {
    return [
      {
        id: 'reap-pending-uploads',
        name: 'Reap pending uploads',
        description:
          'Removes file rows whose upload never arrived, freeing the names they reserved.',
        // Seconds first: at five past every hour.
        cron: '0 5 * * * *',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 5 * 60_000,
        onOverlap: 'skip',
        run: async () => {
          const { scanned, deleted } = await this.files.reapPending(new Date(Date.now() - HOUR));
          return { scanned, deleted };
        },
      },
      {
        id: 'hard-delete-expired',
        name: 'Hard-delete expired nodes',
        description:
          'Destroys nodes soft-deleted more than 30 days ago and their objects. The only place an object is ever removed.',
        cron: '0 0 2 * * *',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 30 * 60_000,
        // `reject`, not `skip`: this one destroys data, and two copies racing
        // over the same subtree is not something to shrug at.
        onOverlap: 'reject',
        run: async () => this.files.hardDeleteExpired(new Date(Date.now() - 30 * DAY)),
      },
      {
        id: 'purge-expired-grants',
        name: 'Purge expired grants',
        description: 'Deletes grants past their expiry, and grants revoked more than 30 days ago.',
        cron: '0 10 2 * * *',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 5 * 60_000,
        onOverlap: 'skip',
        run: async () => ({
          purged: await this.shares.purgeExpired({
            now: new Date(),
            revokedBefore: new Date(Date.now() - 30 * DAY),
          }),
        }),
      },
      {
        id: 'purge-expired-tokens',
        name: 'Purge expired refresh tokens',
        description: 'Deletes refresh tokens past expiry, and revoked ones older than 30 days.',
        cron: '0 20 2 * * *',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 5 * 60_000,
        onOverlap: 'skip',
        run: async () => ({
          purged: await this.refreshTokens.purgeExpired({
            now: new Date(),
            revokedBefore: new Date(Date.now() - 30 * DAY),
          }),
        }),
      },
      {
        id: 'reconcile-rollups',
        name: 'Reconcile subtree rollups',
        description:
          'Compares every folder counter against a live aggregate and repairs what disagrees.',
        cron: '0 30 2 * * *',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 15 * 60_000,
        onOverlap: 'skip',
        /**
         * The one worth building carefully.
         *
         * Silent drift is the classic failure of a denormalized counter, and a
         * job whose result is `{ repaired: 0 }` every day is the only evidence
         * the counters are trustworthy. It repairs as well as reports, and
         * records both numbers — a rising `repaired` against a stable `checked`
         * means something upstream is broken and this is papering over it.
         */
        run: async () => {
          const { checked, repaired } = await this.nodes.reconcileRollups();
          return { checked, drifted: repaired, repaired };
        },
      },
      {
        id: 'prune-job-runs',
        name: 'Prune job run history',
        description: 'Deletes job runs older than 90 days.',
        // Sundays at 03:00.
        cron: '0 0 3 * * 0',
        timezone: 'UTC',
        enabled: true,
        timeoutMs: 5 * 60_000,
        onOverlap: 'skip',
        // This module has the same unbounded-growth problem it was built to
        // detect. A run history that grows forever is the `audit_events` trap
        // in miniature.
        run: async () => ({
          pruned: await this.runs.pruneOlderThan(new Date(Date.now() - 90 * DAY)),
        }),
      },
    ];
  }

  find(id: string): JobDefinition | null {
    return this.all().find((job) => job.id === id) ?? null;
  }

  ids(): JobId[] {
    return this.all().map((job) => job.id);
  }
}
