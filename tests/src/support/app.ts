import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule, type TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';

import { AppModule } from '@api/app.module';
import { configureApp } from '@api/app.setup';
import { APP_CONFIG, PrismaService, loadConfig, type AppConfig } from '@api/common';
import { InMemoryStorageAdapter, STORAGE } from '@api/storage';

/**
 * Boots the real modules against the real database and a fake bucket.
 *
 * `STORAGE` is rebound rather than mocked — the in-memory adapter satisfies the
 * same port, so nothing under test knows the difference. That is the whole
 * reason the port exists, and the reason `API-STORAGE-006` asserts the two
 * adapters cannot diverge.
 *
 * Note what is *not* faked: Prisma, the event bus, the naming service, the
 * transaction boundaries. A test that mocks those asserts that this file is
 * consistent with itself.
 *
 * ## Why it imports `AppModule` rather than listing modules
 *
 * The first version listed the modules it needed. It drifted within the hour:
 * `access` was added to the application and not to this file, so every test
 * asking for `SharesRepository` failed with "this provider does not exist in the
 * current context" — and worse, the `NODE_LOOKUP` binding that `AppModule`
 * performs was simply absent, so the integration suite would have been testing a
 * composition that does not exist in production.
 *
 * Importing the real root removes the whole category. Only the two things that
 * genuinely cannot be real in a test — config and the bucket — are overridden.
 */
export interface TestApp {
  module: TestingModule;
  /**
   * A real Nest application, configured by the **same** `configureApp` that
   * `main.ts` calls.
   *
   * That shared call is the point. Applying helmet, CORS, the zod pipe and
   * `ErrorFilter` by hand here would be a second copy of the composition, and
   * the failure mode is nasty in both directions: forget `ErrorFilter` and every
   * `AppError` arrives as a 500, so a suite asserting "denial is 404" fails for
   * a reason unrelated to its subject; copy it faithfully and it keeps passing
   * after production changes. Same category as this file importing `AppModule`
   * rather than listing modules.
   *
   * Pass `getHttpServer()` to supertest.
   */
  http: INestApplication;
  prisma: PrismaService;
  storage: InMemoryStorageAdapter;
  close: () => Promise<void>;
}

/**
 * The environment the config schema demands, filled with values that are
 * obviously test-only.
 *
 * `DATABASE_URL` is deliberately not defaulted here — `global-setup` sets it to
 * the per-run database, and defaulting it would let a suite silently run against
 * whatever was in the developer's `.env`.
 */
function testEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: 'test-access-secret-not-used-in-anger',
    JWT_REFRESH_SECRET: 'test-refresh-secret-not-used-in-anger',
    SEED_USERS: '[]',
    AWS_REGION: 'eu-central-1',
    S3_BUCKET: 'dataroom-test',
    CORS_ORIGINS: 'http://localhost:5173',
  };
}

export interface TestAppOptions {
  /**
   * A hook for the one legitimate reason to fake something else: an external
   * service this process cannot reach, like Google's token verifier. Anything
   * this repo owns should be real.
   */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** Extra environment, merged over the test defaults. */
  env?: NodeJS.ProcessEnv;
  /**
   * Disables rate limiting for this app instance.
   *
   * The throttle budget is per-IP over a rolling minute, every suite's requests
   * come from `127.0.0.1`, and the storage lives as long as the module does — so
   * any suite making more than a handful of requests to a throttled route
   * eventually fails with 429s that read as permission bugs. Suites that are not
   * *about* the throttle turn it off; `links/throttle.int.spec.ts` leaves it on
   * and is the one place it is asserted.
   *
   * Implemented by replacing `ThrottlerStorage`, and the two more obvious ways
   * both silently do nothing:
   *
   *   - `overrideGuard(ThrottlerGuard)` finds nothing to replace, because the
   *     guard is registered under the `APP_GUARD` token rather than as itself;
   *   - `overrideProvider(APP_GUARD)` misses too — Nest collects enhancer
   *     providers into `ApplicationConfig` while scanning modules, not through
   *     the injector the override touches.
   *
   * Both leave the real guard running and present as "the option was ignored".
   * The storage is an ordinary injectable, so replacing it works — and it keeps
   * the real guard, the real decorators and the real 429 path in the pipeline,
   * with only the counter neutered.
   */
  withoutThrottling?: boolean;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const storage = new InMemoryStorageAdapter();
  const config = loadConfig({ ...testEnv(), ...options.env });

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(STORAGE)
    .useValue(storage);

  if (options.withoutThrottling === true) {
    builder = builder.overrideProvider(ThrottlerStorage).useValue(unlimitedThrottlerStorage());
  }

  if (options.override !== undefined) builder = options.override(builder);

  const module = await builder.compile();

  // `createNestApplication()` rather than `module.init()`: the guards, pipes and
  // filter only exist on an application object, so a bare module gives a suite
  // the services without the request pipeline they run behind — which is most of
  // what an integration test is for.
  const http = configureApp(module.createNestApplication(), config as AppConfig);

  /**
   * **Listening on an ephemeral port, rather than `init()`.**
   *
   * `supertest(server)` calls `listen(0)` itself when the server it is handed is
   * not already listening — so a suite firing requests concurrently races twenty
   * `listen` calls against one server and gets `ECONNRESET` / `ECONNREFUSED`.
   * That is not a hypothetical: it cost two debugging rounds, once in `links`
   * and again in `files`, and the second time the concurrency *was* the subject
   * of the test (`API-FILES-017`, twenty simultaneous uploads) so there was no
   * sequential workaround to fall back on.
   *
   * Binding once here makes supertest reuse the address, so a test that needs
   * genuine parallelism gets it and a test that does not is unaffected.
   */
  await http.listen(0);

  const prisma = module.get(PrismaService);

  return {
    module,
    http,
    prisma,
    storage,
    close: async () => {
      await http.close();
    },
  };
}

/**
 * A `ThrottlerStorage` that always reports this request as the first one.
 *
 * `totalHits: 1` is below every configured limit, so the guard runs in full and
 * always allows. Nothing else about the pipeline changes.
 */
function unlimitedThrottlerStorage(): ThrottlerStorage {
  // The record type is declared but not re-exported from the package index, so
  // the shape is written out rather than imported through a deep path that a
  // patch release is free to move.
  return {
    increment: async () => ({
      totalHits: 1,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    }),
  };
}

/**
 * Empties the tables between files.
 *
 * `TRUNCATE ... CASCADE` rather than deleting rows: it resets in one statement
 * regardless of foreign-key order, which matters for a self-referencing table
 * where a delete order that works today breaks when a column is added.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  // `job_runs` is listed explicitly because it is **not** reached by the
  // cascade: `triggered_by_user_id` is `ON DELETE SET NULL`, so truncating
  // `users` nulls the column and leaves the history behind. That is correct
  // behaviour for the column and a leak between test files, which is exactly
  // the kind of thing a per-file reset is supposed to remove.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "job_runs", "nodes", "users" CASCADE');
}
