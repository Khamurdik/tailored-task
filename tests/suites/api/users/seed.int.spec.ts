import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { verifyPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { UsersService } from '@api/users';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * Provisioning, exercised by **running the real seeder as its own process**.
 *
 * That is not incidental fidelity. `prisma db seed` spawns
 * `node prisma/seed.ts`, and Node runs it under type stripping with no
 * compiler — which is a completely different execution environment from the one
 * every other test here uses. Importing `upsert` and calling it would test the
 * logic and skip the constraint that actually breaks: four TypeScript features
 * that fail outright in that process, one of which (extensionless relative
 * imports) is unavoidable everywhere *else* in `apps/api`.
 *
 * So these tests shell out. It is slower and it is the only way the assertion
 * means what it says.
 */
let app: TestApp;
let prisma: PrismaService;
let users: UsersService;

const API_DIR = resolve(process.cwd(), '../apps/api');

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.prisma;
  users = app.module.get(UsersService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
});

interface SeedUser {
  email: string;
  password: string;
  name: string;
  admin?: boolean;
}

interface SeedRun {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the seeder exactly as `prisma db seed` does. */
function runSeed(seedUsers: string, extra: NodeJS.ProcessEnv = {}): SeedRun {
  try {
    const stdout = execFileSync('node', ['prisma/seed.ts'], {
      cwd: API_DIR,
      encoding: 'utf8',
      env: {
        ...process.env,
        SEED_USERS: seedUsers,
        SEED_FORCE_RESET: 'false',
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (cause) {
    const failure = cause as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

function seedJson(...entries: SeedUser[]): string {
  return JSON.stringify(entries);
}

const ANA: SeedUser = {
  email: `ana-${randomUUID().slice(0, 8)}@example.com`,
  password: 'change-me-now-please',
  name: 'Ana Ruiz',
};

describe('lookup', () => {
  it('API-USERS-001 findByEmail matches across upper and lower case', async () => {
    const email = `Mixed.Case-${randomUUID().slice(0, 8)}@Example.COM`;
    await prisma.user.create({ data: { email, name: 'Mixed', passwordHash: null } });

    // `citext`, not `lower()` at every call site. Case-insensitivity belongs in
    // the column's type: put it in the queries instead and the one query that
    // forgets is a duplicate account, discovered much later.
    for (const spelling of [email, email.toLowerCase(), email.toUpperCase()]) {
      expect(await users.findByEmail(spelling), spelling).not.toBeNull();
    }
  });

  it('API-USERS-002 findByEmail matches across NFC and NFD forms', async () => {
    // `café@example.com` composed and decomposed are different byte strings
    // that render identically. `citext` folds case and **not** composition, so
    // the normalization is the application's job — this asserts the application
    // actually does it rather than assuming the column will.
    const composed = `café-${randomUUID().slice(0, 6)}@example.com`.normalize('NFC');
    const decomposed = composed.normalize('NFD');
    expect(composed).not.toBe(decomposed);

    await prisma.user.create({ data: { email: composed, name: 'Café', passwordHash: null } });

    expect(await users.findByEmail(composed)).not.toBeNull();
    expect(await users.findByEmail(decomposed), 'NFD spelling').not.toBeNull();
  });
});

describe('seeding', () => {
  it('API-USERS-003 seeding an empty database creates exactly the users in SEED_USERS', async () => {
    const bea: SeedUser = { email: `bea-${randomUUID().slice(0, 8)}@example.com`, password: 'another-password-here', name: 'Bea Ok', admin: true };

    const run = runSeed(seedJson(ANA, bea));
    expect(run.status, run.stderr).toBe(0);

    const rows = await prisma.user.findMany({ orderBy: { email: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.email))).toEqual(new Set([ANA.email, bea.email]));
  });

  it('API-USERS-004 seeding twice creates one row per user and rewrites nothing', async () => {
    runSeed(seedJson(ANA));
    const first = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });

    const second = runSeed(seedJson(ANA));
    expect(second.status).toBe(0);
    // The seeder reports what it did, and on a re-run it must report doing
    // nothing rather than quietly rewriting.
    expect(second.stdout).toContain('unchanged');

    const rows = await prisma.user.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.updatedAt.getTime()).toBe(first.updatedAt.getTime());
  });

  it('API-USERS-005 a re-seed does not overwrite an existing password_hash', async () => {
    runSeed(seedJson(ANA));
    const original = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });

    // The operator edits the env var — or simply redeploys with the original
    // one — and the user has since changed their password. Rewriting it here
    // silently reverts every password change anyone has made, which is why this
    // is P0.
    runSeed(seedJson({ ...ANA, password: 'a-completely-different-password' }));

    const after = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });
    expect(after.passwordHash).toBe(original.passwordHash);
  });

  it('API-USERS-006 SEED_FORCE_RESET=true does overwrite it', async () => {
    runSeed(seedJson(ANA));
    const original = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });

    const run = runSeed(seedJson({ ...ANA, password: 'the-deliberate-new-password' }), {
      SEED_FORCE_RESET: 'true',
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('password reset');

    const after = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });
    expect(after.passwordHash).not.toBe(original.passwordHash);
    // And the new password is the one that works — an overwrite that produced
    // an unusable hash would pass a "did it change?" assertion.
    expect(await verifyPassword(after.passwordHash ?? '', 'the-deliberate-new-password')).toBe(true);
  });

  it('API-USERS-007 a seeded user’s hash verifies against auth’s comparison function', async () => {
    runSeed(seedJson(ANA));
    const row = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });

    /**
     * **The test that catches the expensive bug.**
     *
     * The seeder hashes in its own process, under type stripping, and `auth`
     * verifies inside the API. If the two ever drift on argon2 parameters, every
     * seeded user simply cannot log in — and the symptom is indistinguishable
     * from a wrong password, so it presents as "the users you gave me don't
     * work" rather than as a bug with a location.
     *
     * Asserted as a round trip rather than by comparing parameters, because the
     * parameters are what would change and the round trip is what must not.
     */
    expect(await verifyPassword(row.passwordHash ?? '', ANA.password)).toBe(true);
    expect(await verifyPassword(row.passwordHash ?? '', 'not-the-password')).toBe(false);
  });
});

describe('admin, secrecy, and events', () => {
  it('API-USERS-008 a user seeded without admin gets is_admin = false', async () => {
    runSeed(seedJson(ANA));

    const row = await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } });
    // The flag gates `/jobs`, which can trigger a hard delete across every room.
    // Defaulting it on would be a privilege granted by omission.
    expect(row.isAdmin).toBe(false);
  });

  it('API-USERS-009 a re-seed never promotes an existing user to admin by accident', async () => {
    runSeed(seedJson(ANA));
    expect((await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } })).isAdmin).toBe(false);

    // Asking for it explicitly does grant it — that is the supported way to add
    // an operator to a running environment.
    runSeed(seedJson({ ...ANA, admin: true }));
    expect((await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } })).isAdmin).toBe(true);

    // And dropping the flag does **not** revoke it. Demotion is a deliberate act
    // against the database, not a side effect of an edited env var — the
    // opposite rule would make a typo a silent privilege change.
    runSeed(seedJson(ANA));
    expect((await prisma.user.findUniqueOrThrow({ where: { email: ANA.email } })).isAdmin).toBe(true);
  });

  it('API-USERS-010 malformed SEED_USERS aborts with a readable error and inserts nothing', async () => {
    for (const malformed of ['not json at all', '{}', '[{"email":"x"}]', '[{"email":"a@b.c","password":"short"}]']) {
      const run = runSeed(malformed);

      expect(run.status, malformed).not.toBe(0);
      // Readable, and naming the variable. A seed that fails with a stack trace
      // from inside zod is a seed nobody can fix from a CI log.
      expect(run.stderr + run.stdout, malformed).toMatch(/SEED_USERS/);
      expect(await prisma.user.count(), malformed).toBe(0);
    }
  });

  it('API-USERS-011 seeder output contains no password and no hash', async () => {
    const run = runSeed(seedJson(ANA));
    const output = run.stdout + run.stderr;

    // This output goes to CI logs and to a terminal someone may be sharing.
    expect(output).toContain(ANA.email);
    expect(output).not.toContain(ANA.password);
    // argon2 hashes start `$argon2id$`. Printing one is not as bad as printing
    // the password and is still a credential-shaped secret in a build log.
    expect(output).not.toContain('$argon2');
  });

  it('API-USERS-013 google_sub is unique — two users cannot claim one Google identity', async () => {
    const sub = `google-sub-${randomUUID()}`;
    await prisma.user.create({
      data: { email: `first-${randomUUID().slice(0, 8)}@example.com`, name: 'First', googleSub: sub },
    });

    // Enforced by the database rather than by a check in `auth`, so the one code
    // path that forgets to look cannot create the second row.
    await expect(
      prisma.user.create({
        data: { email: `second-${randomUUID().slice(0, 8)}@example.com`, name: 'Second', googleSub: sub },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('API-USERS-015 the seeder runs to completion under Node’s type stripping', async () => {
    // The environment constraint, asserted by execution. Four TypeScript
    // features fail in this process — decorators, parameter properties, `enum`
    // and extensionless relative imports — and the whole transitive import
    // graph of `prisma/seed.ts` is subject to all four.
    const run = runSeed(seedJson(ANA));

    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).not.toMatch(/SyntaxError|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|ERR_MODULE_NOT_FOUND/);
    expect(run.stdout).toContain('Seeded 1 user(s).');
  });
});
