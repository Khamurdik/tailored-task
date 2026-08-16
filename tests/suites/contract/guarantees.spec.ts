import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as contract from '@dataroom/shared';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, REPO_ROOT)), 'utf8');

describe('cross-cutting guarantees', () => {
  it('CONTRACT-009 cursor fields are opaque strings, never structured objects', () => {
    const page = {
      items: [],
      nextCursor: 'ZW5jb2RlZC1jdXJzb3I',
      breadcrumbs: [],
    };
    expect(contract.ChildrenPageSchema.safeParse(page).success).toBe(true);
    expect(contract.ChildrenPageSchema.safeParse({ ...page, nextCursor: null }).success).toBe(true);

    // A structured cursor is the failure this guards: the moment a client can
    // read `{ name, id }` out of it, the server can no longer change how it
    // paginates without breaking clients that peeked.
    for (const nextCursor of [{ name: 'a', id: 'b' }, ['a', 'b'], 42, { toString: 'x' }]) {
      expect(
        contract.ChildrenPageSchema.safeParse({ ...page, nextCursor }).success,
        `${JSON.stringify(nextCursor)} should not parse as a cursor`,
      ).toBe(false);
    }
  });

  it('CONTRACT-010 JobStatus union matches the six statuses jobs declares', () => {
    const spec = read('apps/api/src/jobs/TODO.md');
    const block = /type JobStatus =\s*([\s\S]*?);/.exec(spec)?.[1];

    expect(block, 'could not find the JobStatus union in jobs/TODO.md').toBeTruthy();

    // Strip line comments first. The spec annotates each status, and one of
    // those annotations mentions `onOverlap: 'skip'` — which a naive scan reads
    // as a seventh status.
    const declared = (block ?? '').replace(/\/\/[^\n]*/g, '');
    const specified = new Set(declared.match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)));
    const exported = new Set<string>(contract.JobStatusSchema.options);

    expect(specified.size).toBe(6);
    expect([...specified].sort()).toEqual([...exported].sort());
  });

  it('CONTRACT-011 nextRunAt parses as an ISO string and rejects a Luxon object', () => {
    const job = {
      id: 'reap-pending-uploads' as const,
      name: 'Reap pending uploads',
      description: 'Deletes pending nodes whose upload never completed.',
      cron: '0 0 * * * *',
      timezone: 'UTC' as const,
      enabled: true,
      timeoutMs: 60_000,
      onOverlap: 'skip' as const,
      nextRunAt: '2026-08-16T14:22:05.123Z',
      lastRun: null,
    };
    expect(contract.JobSummarySchema.safeParse(job).success).toBe(true);
    expect(contract.JobSummarySchema.safeParse({ ...job, nextRunAt: null }).success).toBe(true);

    // `cron@4` hands the API a Luxon DateTime from `nextDate()`. Serialized
    // straight through it becomes an object of internal fields, and
    // `new Date(nextDate())` yields Invalid Date — so the contract has to be
    // the thing that refuses it.
    const luxonish = { ts: 1_755_353_725_123, zone: { name: 'UTC' }, isLuxonDateTime: true };
    expect(contract.JobSummarySchema.safeParse({ ...job, nextRunAt: luxonish }).success).toBe(false);
    expect(contract.JobSummarySchema.safeParse({ ...job, nextRunAt: 1_755_353_725_123 }).success).toBe(
      false,
    );
    expect(contract.JobSummarySchema.safeParse({ ...job, nextRunAt: 'soon' }).success).toBe(false);
  });

  it('CONTRACT-012 no Prisma model type is reachable from this package exports', () => {
    const pkg = JSON.parse(read('packages/shared/package.json')) as {
      dependencies?: Record<string, string>;
    };

    // Zero runtime dependencies beyond zod. Anything heavier belongs in an app,
    // and `@prisma/client` in particular would let the database schema and the
    // wire format become the same thing.
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);

    const sources = ['index', 'nodes', 'shares', 'auth', 'jobs', 'uploads', 'events', 'errors'];
    for (const name of sources) {
      const source = read(`packages/shared/src/${name}.ts`);
      expect(source, `${name}.ts reaches for Prisma`).not.toMatch(/@prisma|PrismaClient|\$Enums/);
    }

    expect(Object.keys(contract).filter((key) => /prisma/i.test(key))).toEqual([]);
  });
});
