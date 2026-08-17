import { randomUUID } from 'node:crypto';

import type { JobRunDetail, JobSummary } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { JobRegistry, JobRunner, JobRunsRepository, type JobDefinition } from '@api/jobs';
import { NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * Job runs, as objects.
 *
 * The runner is driven directly with **purpose-built definitions** for the
 * behaviours that are about the runner rather than about any particular job —
 * a handler that throws, one that hangs, one that must not run twice. Building
 * those out of the real six would mean provoking a genuine failure in
 * `hard-delete-expired` to observe what a failure looks like, which tests the
 * wrong thing and is a great deal harder to arrange.
 *
 * The endpoint tests use the real registry, because there the point is exactly
 * that what you see is what is registered.
 */
let app: TestApp;
let prisma: PrismaService;
let runner: JobRunner;
let runs: JobRunsRepository;
let registry: JobRegistry;
let nodes: NodesService;
let server: Parameters<typeof request>[0];
let adminToken: string;
let adminId: string;

const PASSWORD = 'a-real-password-2026';

beforeAll(async () => {
  app = await createTestApp({ withoutThrottling: true });
  prisma = app.prisma;
  runner = app.module.get(JobRunner);
  runs = app.module.get(JobRunsRepository);
  registry = app.module.get(JobRegistry);
  nodes = app.module.get(NodesService);
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);

  const email = `admin-${randomUUID().slice(0, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: 'Operator', passwordHash: await hashPassword(PASSWORD), isAdmin: true },
  });
  adminId = user.id;
  adminToken = (await app.module.get(AuthService).login(email, PASSWORD)).accessToken;
});

/** A definition with a handler this test controls. Real id, so the row is valid. */
function fakeJob(overrides: Partial<JobDefinition> = {}): JobDefinition {
  return {
    id: 'prune-job-runs',
    name: 'Test job',
    description: 'Exists for the duration of one test.',
    cron: '0 0 4 * * *',
    timezone: 'UTC',
    enabled: true,
    timeoutMs: 5_000,
    onOverlap: 'skip',
    run: async () => ({ ok: 1 }),
    ...overrides,
  };
}

/** The runner starts the handler and returns; these are asynchronous by design. */
async function settle(ms = 120): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
}

describe('a run is an object', () => {
  it('API-JOBS-006 a run row is inserted as running before the handler is invoked', async () => {
    let statusDuringHandler: string | undefined;

    const job = fakeJob({
      run: async () => {
        // The row must already exist while the handler is executing — that is
        // what makes a crash inside it visible as an attempt rather than as
        // nothing at all.
        const rows = await prisma.jobRun.findMany();
        statusDuringHandler = rows[0]?.status;
        return { ok: 1 };
      },
    });

    await runner.run(job, { trigger: 'manual', triggeredByUserId: adminId });
    await settle();

    expect(statusDuringHandler).toBe('running');
  });

  it('API-JOBS-007 a successful run ends succeeded with its result recorded', async () => {
    const record = await runner.run(fakeJob({ run: async () => ({ scanned: 7, deleted: 3 }) }), {
      trigger: 'schedule',
    });
    await settle();

    const finished = await runs.findById(record.id);
    expect(finished?.status).toBe('succeeded');
    // The result is what makes a green run informative rather than merely green.
    expect(finished?.result).toEqual({ scanned: 7, deleted: 3 });
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('API-JOBS-008 a throwing job ends failed with the message recorded, and the app survives', async () => {
    const record = await runner.run(
      fakeJob({
        run: () => {
          throw new Error('the disk is on fire');
        },
      }),
      { trigger: 'schedule' },
    );
    await settle();

    const finished = await runs.findById(record.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.errorMessage).toBe('the disk is on fire');

    // Contained: the next job runs perfectly well afterwards. A failure that
    // took the process down would take every other job with it.
    const next = await runner.run(fakeJob({ run: async () => ({ ok: 1 }) }), { trigger: 'schedule' });
    await settle();
    expect((await runs.findById(next.id))?.status).toBe('succeeded');
  });

  it('API-JOBS-009 a job exceeding its timeout ends timed_out and its AbortSignal fires', async () => {
    let aborted = false;

    const record = await runner.run(
      fakeJob({
        timeoutMs: 60,
        run: async (context) => {
          context.signal.addEventListener('abort', () => {
            aborted = true;
          });
          // Longer than the timeout, and it does not cooperate — which is the
          // case worth covering: the run must still reach a terminal status
          // even when the handler ignores the signal entirely.
          await new Promise((done) => setTimeout(done, 3_000));
          return { ok: 1 };
        },
      }),
      { trigger: 'schedule' },
    );

    await settle(400);

    const finished = await runs.findById(record.id);
    expect(finished?.status).toBe('timed_out');
    expect(aborted, 'the AbortSignal fired').toBe(true);
  });

  it('API-JOBS-010 onOverlap skip records a skipped run and does not run the handler twice', async () => {
    let invocations = 0;

    const job = fakeJob({
      onOverlap: 'skip',
      run: async () => {
        invocations += 1;
        await new Promise((done) => setTimeout(done, 300));
        return { ok: 1 };
      },
    });

    const first = await runner.run(job, { trigger: 'schedule' });
    const second = await runner.run(job, { trigger: 'schedule' });

    // A skipped run is recorded rather than silently dropped: "did not run
    // because another copy was running" and "did not run and nobody knows why"
    // must not look the same in the history.
    expect(second.status).toBe('skipped');
    expect(second.id).not.toBe(first.id);
    expect(invocations).toBe(1);

    await settle(500);
    expect((await runs.findById(first.id))?.status).toBe('succeeded');
  });

  it('API-JOBS-011 the startup sweep converts an orphaned running row to interrupted', async () => {
    // The row a process that died mid-run leaves behind.
    const orphan = await runs.start({ jobId: 'reap-pending-uploads', trigger: 'schedule' });

    const swept = await runs.sweepInterrupted();
    expect(swept).toBeGreaterThanOrEqual(1);

    const after = await runs.findById(orphan.id);
    expect(after?.status).toBe('interrupted');
    // The CHECK constraint ties these to the status, so a sweep that set the
    // status alone would fail at the database rather than leave a half-row.
    expect(after?.finishedAt).not.toBeNull();
    expect(after?.durationMs).not.toBeNull();
  });

  it('API-JOBS-012 after the sweep a previously orphaned skip job can run again', async () => {
    const job = fakeJob({ onOverlap: 'skip' });

    // Orphaned: `running`, and nothing is going to finish it.
    await runs.start({ jobId: job.id, trigger: 'schedule' });

    const blocked = await runner.run(job, { trigger: 'manual', triggeredByUserId: adminId });
    expect(blocked.status, 'blocked while the orphan looks live').toBe('skipped');

    await runs.sweepInterrupted();

    // This is the failure the sweep exists to prevent: without it, an
    // `onOverlap: 'skip'` job skips **forever** and the symptom is a job that
    // silently never runs again.
    const recovered = await runner.run(job, { trigger: 'manual', triggeredByUserId: adminId });
    await settle();
    expect((await runs.findById(recovered.id))?.status).toBe('succeeded');
  });

  it('API-JOBS-024 a running row older than its timeout is treated as dead without a restart', async () => {
    const job = fakeJob({ onOverlap: 'skip', timeoutMs: 1_000 });

    const orphan = await runs.start({ jobId: job.id, trigger: 'schedule' });
    // Older than the one-hour floor, which is what the staleness test uses when
    // a job's own timeout is shorter.
    await prisma.$executeRaw`
      UPDATE "job_runs" SET "started_at" = now() - interval '3 hours' WHERE "id" = ${orphan.id}::uuid
    `;

    /**
     * The guard the startup sweep cannot cover: this recovers **without a
     * restart**, which matters because the alternative is an operator having to
     * redeploy to unstick a job.
     */
    const recovered = await runner.run(job, { trigger: 'manual', triggeredByUserId: adminId });
    await settle();

    expect(recovered.status).not.toBe('skipped');
    expect((await runs.findById(recovered.id))?.status).toBe('succeeded');
  });

  it('API-JOBS-023 run history is append-then-update-once and no endpoint deletes a run', async () => {
    const record = await runner.run(fakeJob(), { trigger: 'manual', triggeredByUserId: adminId });
    await settle();

    // There is no DELETE route. Runs are history; the only path that removes one
    // is `prune-job-runs`, on a schedule, at ninety days.
    for (const path of [`/jobs/runs/${record.id}`, `/jobs/reap-pending-uploads/runs`]) {
      const response = await request(server)
        .delete(path)
        .set('Authorization', `Bearer ${adminToken}`);
      expect([404, 405], path).toContain(response.status);
    }

    expect(await prisma.jobRun.count({ where: { id: record.id } })).toBe(1);
  });
});

describe('triggering by hand', () => {
  it('API-JOBS-014 POST /jobs/:id/run returns 202 with an immediately queryable runId', async () => {
    const response = await request(server)
      .post('/jobs/prune-job-runs/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(202);

    const { runId } = response.body as { runId: string };
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);

    // 202 and not 200: the caller polls rather than waiting, because these run
    // for minutes and a blocking trigger is a gateway timeout with a job still
    // going behind it.
    const run = await request(server)
      .get(`/jobs/runs/${runId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect((run.body as JobRunDetail).id).toBe(runId);
  });

  it('API-JOBS-015 a manual run records who triggered it', async () => {
    const response = await request(server)
      .post('/jobs/prune-job-runs/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(202);

    await settle();
    const { runId } = response.body as { runId: string };
    const run = await runs.findById(runId);

    // "Who ran the hard-delete?" must be answerable.
    expect(run?.trigger).toBe('manual');
    expect(run?.triggeredByUserId).toBe(adminId);

    // A scheduled run has nobody to name, and null is the honest value.
    const scheduled = await runner.run(fakeJob(), { trigger: 'schedule' });
    expect(scheduled.triggeredByUserId).toBeNull();
  });

  it('API-JOBS-016 a manual run works on a disabled job', async () => {
    const disabled = fakeJob({ enabled: false });

    // Disabling a schedule must not remove the ability to run something
    // deliberately — that is exactly what an operator disables a schedule in
    // order to do.
    const record = await runner.run(disabled, { trigger: 'manual', triggeredByUserId: adminId });
    await settle();

    expect((await runs.findById(record.id))?.status).toBe('succeeded');
  });

  it('API-JOBS-021 reconcile-rollups reports and repairs a deliberately corrupted counter', async () => {
    const room = await nodes.createRoom(adminId, 'Counted');
    await nodes.createFolder(room.id, 'A');

    // Corrupt exactly the derived columns, the way drift would.
    await prisma.$executeRaw`
      UPDATE "nodes" SET "subtree_files" = 99, "subtree_bytes" = 12345 WHERE "id" = ${room.id}::uuid
    `;

    const job = registry.find('reconcile-rollups');
    expect(job).not.toBeNull();

    const record = await runner.run(job as JobDefinition, {
      trigger: 'manual',
      triggeredByUserId: adminId,
    });
    await settle(400);

    const finished = await runs.findById(record.id);
    expect(finished?.status).toBe('succeeded');

    // Reports **and** repairs, and records both numbers: a rising repaired
    // count against a stable checked count means something upstream is broken
    // and this job is papering over it.
    const result = finished?.result as { checked: number; drifted: number; repaired: number };
    expect(result.checked).toBeGreaterThan(0);
    expect(result.repaired).toBeGreaterThanOrEqual(1);

    const repaired = await prisma.node.findUniqueOrThrow({ where: { id: room.id } });
    expect(repaired.subtreeFiles).toBe(0);
    expect(Number(repaired.subtreeBytes)).toBe(0);
  });

  it('API-JOBS-022 prune-job-runs deletes runs older than 90 days and nothing newer', async () => {
    const old = await runs.start({ jobId: 'reap-pending-uploads', trigger: 'schedule' });
    await runs.finish({ id: old.id, status: 'succeeded', result: { ok: 1 } });
    const recent = await runs.start({ jobId: 'reap-pending-uploads', trigger: 'schedule' });
    await runs.finish({ id: recent.id, status: 'succeeded', result: { ok: 1 } });

    await prisma.$executeRaw`
      UPDATE "job_runs" SET "started_at" = now() - interval '100 days' WHERE "id" = ${old.id}::uuid
    `;

    const job = registry.find('prune-job-runs');
    const record = await runner.run(job as JobDefinition, { trigger: 'manual', triggeredByUserId: adminId });
    await settle(300);

    expect(await prisma.jobRun.count({ where: { id: old.id } })).toBe(0);
    expect(await prisma.jobRun.count({ where: { id: recent.id } })).toBe(1);
    // Its own run survives — a prune that took itself would be its own last
    // record.
    expect(await prisma.jobRun.count({ where: { id: record.id } })).toBe(1);
  });

  it('API-JOBS-020 every job is idempotent — running it twice leaves the same state', async () => {
    const room = await nodes.createRoom(adminId, 'Twice');
    await nodes.createFolder(room.id, 'Folder');

    for (const definition of registry.all()) {
      const first = await runner.run(definition, { trigger: 'manual', triggeredByUserId: adminId });
      await settle(300);
      const second = await runner.run(definition, { trigger: 'manual', triggeredByUserId: adminId });
      await settle(300);

      // Manual triggering makes this a hard requirement rather than a nicety:
      // an operator can and will run these back to back.
      const firstRun = await runs.findById(first.id);
      const secondRun = await runs.findById(second.id);

      expect(firstRun?.status, `${definition.id} first`).toBe('succeeded');
      expect(['succeeded', 'skipped'], `${definition.id} second`).toContain(secondRun?.status);
    }

    // Nothing was destroyed by running the whole registry twice over a live
    // tree — the tree is intact.
    expect(await prisma.node.count({ where: { deletedAt: null } })).toBe(2);
  }, 60_000);
});

describe('who may look', () => {
  it('API-JOBS-017 a non-admin gets 404 from every endpoint in this module', async () => {
    const email = `ordinary-${randomUUID().slice(0, 8)}@example.com`;
    await prisma.user.create({
      data: { email, name: 'Ordinary', passwordHash: await hashPassword(PASSWORD) },
    });
    const theirs = await app.module.get(AuthService).login(email, PASSWORD);

    const record = await runner.run(fakeJob(), { trigger: 'manual', triggeredByUserId: adminId });

    // 404 rather than 403: these endpoints expose deletion counts across every
    // room and can trigger a hard delete, and the existence of an admin surface
    // is not something a non-admin needs confirmed.
    const attempts: [string, () => request.Test][] = [
      ['GET /jobs', () => request(server).get('/jobs')],
      ['GET /jobs/:id', () => request(server).get('/jobs/prune-job-runs')],
      ['GET /jobs/:id/runs', () => request(server).get('/jobs/prune-job-runs/runs')],
      ['GET /jobs/runs/:runId', () => request(server).get(`/jobs/runs/${record.id}`)],
      ['POST /jobs/:id/run', () => request(server).post('/jobs/prune-job-runs/run')],
    ];

    for (const [label, attempt] of attempts) {
      const response = await attempt().set('Authorization', `Bearer ${theirs.accessToken}`);
      expect(response.status, label).toBe(404);
      expect(response.body, label).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }
  });

  it('API-JOBS-018 an anonymous caller gets 404, not 401', async () => {
    // The one place this module deliberately differs from `@RequireAuth()`,
    // which would answer 401 and thereby confirm the route exists.
    const response = await request(server).get('/jobs').expect(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });
});

describe('listing', () => {
  it('API-JOBS-005 a disabled job still appears in GET /jobs with nextRunAt null', async () => {
    const response = await request(server)
      .get('/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const items = (response.body as { items: JobSummary[] }).items;
    expect(items.length).toBe(registry.all().length);

    // `JOBS_DISABLED` names one, and it still lists — a job you cannot see is a
    // job you forget exists.
    const disabledApp = await createTestApp({
      withoutThrottling: true,
      env: { JOBS_DISABLED: 'prune-job-runs' },
    });
    try {
      const email = `admin2-${randomUUID().slice(0, 8)}@example.com`;
      await prisma.user.create({
        data: { email, name: 'Op', passwordHash: await hashPassword(PASSWORD), isAdmin: true },
      });
      const session = await disabledApp.module.get(AuthService).login(email, PASSWORD);

      const listed = await request(disabledApp.http.getHttpServer())
        .get('/jobs')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      const pruner = (listed.body as { items: JobSummary[] }).items.find(
        (job) => job.id === 'prune-job-runs',
      );
      expect(pruner, 'still listed').toBeDefined();
      expect(pruner?.enabled).toBe(false);
      expect(pruner?.nextRunAt).toBeNull();
    } finally {
      await disabledApp.close();
    }
  }, 30_000);

  it('API-JOBS-019 nextRunAt serializes as an ISO string, not a Luxon object', async () => {
    const response = await request(server)
      .get('/jobs')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const enabled = (response.body as { items: JobSummary[] }).items.filter((job) => job.enabled);
    expect(enabled.length).toBeGreaterThan(0);

    for (const job of enabled) {
      /**
       * `@nestjs/schedule@6` depends on `cron@4`, which is Luxon-based:
       * `nextDate()` returns a `DateTime`, not a `Date`. Handing it straight to
       * the serializer produces a blob of internal Luxon fields, and
       * `new Date(nextDate())` yields `Invalid Date`.
       */
      expect(typeof job.nextRunAt, job.id).toBe('string');
      expect(Number.isNaN(new Date(job.nextRunAt ?? '').getTime()), job.id).toBe(false);
    }
  });

  it('API-JOBS-004 a JOBS_CRON_* override replaces the registry default', async () => {
    const overridden = await createTestApp({
      withoutThrottling: true,
      // Upper-snake-cased id, per `collectCronOverrides`.
      env: { JOBS_CRON_PRUNE_JOB_RUNS: '0 0 5 * * *' },
    });

    try {
      const email = `admin3-${randomUUID().slice(0, 8)}@example.com`;
      await prisma.user.create({
        data: { email, name: 'Op', passwordHash: await hashPassword(PASSWORD), isAdmin: true },
      });
      const session = await overridden.module.get(AuthService).login(email, PASSWORD);

      const listed = await request(overridden.http.getHttpServer())
        .get('/jobs')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      const pruner = (listed.body as { items: JobSummary[] }).items.find(
        (job) => job.id === 'prune-job-runs',
      );
      // The value in the registry is the default, not the only option — a
      // schedule can be changed without a deploy.
      expect(pruner?.cron).toBe('0 0 5 * * *');
    } finally {
      await overridden.close();
    }
  }, 30_000);

  it('API-JOBS-025 with the scheduler flag off, reads and manual triggers still work', async () => {
    const unscheduled = await createTestApp({
      withoutThrottling: true,
      env: { JOBS_SCHEDULER_ENABLED: 'false' },
    });

    try {
      const email = `admin4-${randomUUID().slice(0, 8)}@example.com`;
      const user = await prisma.user.create({
        data: { email, name: 'Op', passwordHash: await hashPassword(PASSWORD), isAdmin: true },
      });
      const session = await unscheduled.module.get(AuthService).login(email, PASSWORD);
      const other = request(unscheduled.http.getHttpServer());

      // This is the flag that makes "exactly one instance schedules" a switch
      // rather than a hope, so the rest of the surface has to keep working on
      // the instances that have it off.
      const listed = await other
        .get('/jobs')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(200);

      for (const job of (listed.body as { items: JobSummary[] }).items) {
        expect(job.nextRunAt, `${job.id} is not scheduled here`).toBeNull();
      }

      const triggered = await request(unscheduled.http.getHttpServer())
        .post('/jobs/prune-job-runs/run')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(202);

      expect((triggered.body as { runId: string }).runId).toBeTruthy();
      expect(user.isAdmin).toBe(true);
    } finally {
      await unscheduled.close();
    }
  }, 30_000);

  it('API-JOBS-002 a malformed cron expression crashes the app at boot, not at first fire', async () => {
    /**
     * Validated before anything is registered, so a bad expression is a deploy
     * that fails loudly rather than a job that throws at 3am — and the message
     * names the job and the expression, because "invalid cron" on its own is
     * not something anyone can act on.
     */
    await expect(
      createTestApp({
        withoutThrottling: true,
        override: (builder) =>
          builder.overrideProvider(JobRegistry).useValue({
            all: () => [fakeJob({ cron: 'not a cron expression at all' })],
            find: () => null,
            ids: () => [],
          }),
      }),
    ).rejects.toThrow(/invalid cron expression/i);
  }, 30_000);

  it('API-JOBS-013 RETIRED advisory-lock multi-instance claim', () => {
    // Retired rather than deleted, per the format rules: the number is never
    // reused. `pg_try_advisory_lock` is session-scoped, Prisma pools
    // connections, and Neon's pooled endpoint is PgBouncer in transaction mode
    // — so the lock would appear to work in dev against a direct connection and
    // silently stop working in production. Single-instance scheduling replaced
    // it; see `jobs/TODO.md` §5.
    expect(true).toBe(true);
  });
});
