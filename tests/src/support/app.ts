import { Test, type TestingModule, type TestingModuleBuilder } from '@nestjs/testing';

import { AppModule } from '@api/app.module';
import { APP_CONFIG, PrismaService, loadConfig } from '@api/common';
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
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const storage = new InMemoryStorageAdapter();

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(loadConfig({ ...testEnv(), ...options.env }))
    .overrideProvider(STORAGE)
    .useValue(storage);

  if (options.override !== undefined) builder = options.override(builder);

  const module = await builder.compile();

  await module.init();
  const prisma = module.get(PrismaService);

  return {
    module,
    prisma,
    storage,
    close: async () => {
      await module.close();
    },
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
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "nodes", "users" CASCADE');
}
