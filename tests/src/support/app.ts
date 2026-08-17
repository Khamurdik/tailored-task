import { Test, type TestingModule } from '@nestjs/testing';

import { APP_CONFIG, CommonModule, PrismaService, loadConfig } from '@api/common';
import { NodesModule } from '@api/nodes';
import { InMemoryStorageAdapter, STORAGE } from '@api/storage';
import { UsersModule } from '@api/users';

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

export async function createTestApp(): Promise<TestApp> {
  const storage = new InMemoryStorageAdapter();

  const module = await Test.createTestingModule({
    imports: [CommonModule, UsersModule, NodesModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(loadConfig(testEnv()))
    .overrideProvider(STORAGE)
    .useValue(storage)
    .compile();

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
