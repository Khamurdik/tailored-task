import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Brings up the database for the `api-integration` project.
 *
 * **A disposable database per run, not cleanup between tests.** Cleaning up is
 * the approach that works until one test leaves a row behind, and then the
 * failure lands in whichever test happens to run next. A fresh schema costs a
 * second and removes the whole category.
 *
 * Postgres comes from `docker-compose.test.yml` rather than `testcontainers` —
 * a dependency and a Docker-API integration for what six lines of compose do —
 * and rather than a Neon branch, which needs credentials in CI and network on
 * every run.
 */

const REPO_ROOT = resolve(process.cwd(), '..');
const COMPOSE_FILE = resolve(REPO_ROOT, 'docker-compose.test.yml');
const API_DIR = resolve(REPO_ROOT, 'apps/api');

/** A distinct database on the same container, so a test run cannot wipe dev data. */
const TEST_DATABASE = 'dataroom_test';

/**
 * Two ports for one database, and mixing them up is the first thing that goes
 * wrong here.
 *
 * `docker-compose.test.yml` maps host **5433** to container **5432** — the
 * non-default host port so it cannot collide with a Postgres the developer
 * already runs. So anything executed *inside* the container (`docker exec psql`)
 * must use 5432, and anything on the host (Prisma, the app under test) must use
 * 5433. Using the host port inside the container fails with "connection
 * refused", which reads as "the database is not up" when it very much is.
 */
const IN_CONTAINER_ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
const TEST_URL = `postgresql://postgres:postgres@localhost:5433/${TEST_DATABASE}?schema=public`;

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): string {
  return execFileSync(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Runs SQL as the superuser, from inside the container. See the port note above. */
function psql(sql: string): string {
  return run('docker', ['exec', 'dataroom-postgres', 'psql', IN_CONTAINER_ADMIN_URL, '-tAc', sql]);
}

function isContainerHealthy(): boolean {
  try {
    return run('docker', ['inspect', '-f', '{{.State.Health.Status}}', 'dataroom-postgres']).trim() === 'healthy';
  } catch {
    return false;
  }
}

export default async function setup(): Promise<void> {
  if (!existsSync(COMPOSE_FILE)) {
    throw new Error(`Missing ${COMPOSE_FILE}. The integration suite needs a database.`);
  }

  if (!isContainerHealthy()) {
    // Started here rather than required to be running, so `pnpm test` works on
    // a clean checkout. Idempotent — compose is a no-op if it is already up.
    run('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d']);

    // The healthcheck matters: `pg_isready` returns true while the server is
    // still running first-time initialisation, so connecting immediately fails
    // with an error that looks like bad credentials.
    for (let attempt = 0; attempt < 45; attempt += 1) {
      if (isContainerHealthy()) break;
      await new Promise((done) => setTimeout(done, 1000));
    }
    if (!isContainerHealthy()) throw new Error('Postgres did not become healthy in 45s');
  }

  // Dropped and recreated, so every run starts from the migrations rather than
  // from whatever the last run left.
  psql(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
  psql(`CREATE DATABASE ${TEST_DATABASE}`);

  // `migrate deploy`, not `migrate dev`: deploy applies exactly what is
  // committed and never generates, prompts, or seeds. A test run that could
  // author a migration is a test run that can change the repo.
  run('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { DATABASE_URL: TEST_URL },
  });

  process.env['DATABASE_URL'] = TEST_URL;
}

export { TEST_URL };
