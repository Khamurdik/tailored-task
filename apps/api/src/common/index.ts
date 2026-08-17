/**
 * The public surface of L0. Every other module imports from here, never from a
 * file inside `common/`.
 */
export { APP_CONFIG, loadConfig, type AppConfig } from './config/app-config';
export { EnvSchema, collectCronOverrides, type Env } from './config/env.schema';
export { SeedUserSchema, SeedUsersSchema, parseSeedUsers, type SeedUser } from './config/seed-users.schema';

export { AppError } from './errors/app-error';
export { ErrorFilter } from './errors/error.filter';

export { EventBus, type Listener } from './events/event-bus.service';
export { PrismaService } from './prisma/prisma.service';

export {
  InvalidCursorError,
  decodeCursor,
  encodeCursor,
  type CursorPayload,
} from './pagination/cursor';
export { CursorService } from './pagination/cursor.service';

export { normalizeName, sanitizeName, suggestConflictName } from './naming/names';

export type { AccessContext, RequestActor } from './http/request-context';

export { CommonModule } from './common.module';

/**
 * Re-exported, not redeclared. `packages/shared` owns these — the client
 * validates against the same numbers the server enforces, and a second
 * declaration here is how those two drift.
 */
export { MAX_DEPTH, MAX_FILE_SIZE, MAX_NAME_LENGTH, PAGE_SIZE } from '@dataroom/shared';
