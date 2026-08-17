import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Brings up the world the journeys need: a database of their own, migrations,
 * and seeded people.
 *
 * A **separate database** from both dev and `api-integration`. Journeys are the
 * slowest tier and the one most likely to be interrupted half-way, so they must
 * not be able to leave a developer's data — or another suite's — in a state
 * nobody expects.
 *
 * Postgres and MinIO come from the same `docker-compose.test.yml` the
 * integration suite uses. MinIO is not optional here: the journeys exist to
 * cover what only appears when the browser, the API **and the bucket** are all
 * real, and an upload is most of that.
 */
const REPO_ROOT = resolve(process.cwd(), '..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.test.yml');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

const DATABASE = 'dataroom_e2e';

/** See the port note in `global-setup.ts`: 5433 on the host, 5432 in the container. */
const IN_CONTAINER_ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
export const E2E_DATABASE_URL = `postgresql://postgres:postgres@localhost:5433/${DATABASE}?schema=public`;

/**
 * The people the journeys act as. Every persona in `journeys/TODO.md` that needs
 * an account is here, because a journey that provisions its own user is a
 * journey that depends on an endpoint this system deliberately does not have.
 */
export const PEOPLE = {
  owner: { email: 'ana@example.com', password: 'change-me-now-please', name: 'Ana Ruiz' },
  stranger: { email: 'sam@example.com', password: 'change-me-too-please', name: 'Sam Stranger' },
  admin: { email: 'ada@example.com', password: 'change-me-admin-now', name: 'Ada Admin' },
  /** Invited by email before they ever sign in. See JOURNEY-020. */
  invitee: { email: 'bea@example.com', password: 'change-me-invitee-x', name: 'Bea Later' },
} as const;

export const SEED_USERS = JSON.stringify([
  { ...PEOPLE.owner, admin: false },
  { ...PEOPLE.stranger, admin: false },
  { ...PEOPLE.admin, admin: true },
  { ...PEOPLE.invitee, admin: false },
]);

/** Where `auth.setup.ts` writes each persona's signed-in state. */
export function storageStatePath(role: string): string {
  return resolve(process.cwd(), `.auth/${role}.json`);
}

function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): string {
  return execFileSync(command, args, {
    // `cwd`, not a `PWD` environment variable — setting the latter does not
    // change the working directory, and `pnpm exec` then reports
    // "No package found in this workspace" from the repository root.
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function psql(sql: string): string {
  return run('docker', ['exec', 'dataroom-postgres', 'psql', IN_CONTAINER_ADMIN_URL, '-tAc', sql]);
}

function isHealthy(container: string): boolean {
  try {
    return run('docker', ['inspect', '-f', '{{.State.Health.Status}}', container]).trim() === 'healthy';
  } catch {
    return false;
  }
}

/**
 * Run as a **script before Playwright starts**, not as its `globalSetup`.
 *
 * Playwright launches `webServer` first and runs `globalSetup` afterwards — so
 * a global setup that creates the database is too late by exactly the amount
 * that matters: the API has already tried to connect and exited with
 * `P1003 Database does not exist`. Wiring it into `test:e2e` ahead of the
 * runner is the only ordering that works.
 */
export async function prepareE2eEnvironment(): Promise<void> {
  if (!isHealthy('dataroom-postgres') || !isHealthy('dataroom-minio')) {
    run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d']);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (isHealthy('dataroom-postgres') && isHealthy('dataroom-minio')) break;
      await new Promise((done) => setTimeout(done, 1000));
    }
  }

  if (!isHealthy('dataroom-postgres')) throw new Error('Postgres did not become healthy');
  if (!isHealthy('dataroom-minio')) throw new Error('MinIO did not become healthy');

  // Dropped and recreated, so a run starts from the migrations rather than from
  // whatever the last one left behind.
  psql(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  psql(`CREATE DATABASE ${DATABASE}`);

  // `migrate deploy`, never `migrate dev`: a test run that can author a
  // migration is a test run that can change the repository.
  run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { DATABASE_URL: E2E_DATABASE_URL },
  });

  run('pnpm', ['exec', 'prisma', 'db', 'seed'], {
    cwd: API_DIR,
    env: { DATABASE_URL: E2E_DATABASE_URL, SEED_USERS },
  });
}
