import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, loadConfig, type AppConfig } from './config/app-config';
import { CursorService } from './pagination/cursor.service';
import { EventBus } from './events/event-bus.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';

/**
 * L0. Config, database, the event bus, cursors, and health.
 *
 * `@Global` because every module needs `PrismaService` and `APP_CONFIG`, and
 * importing `CommonModule` into all eleven of them is noise that hides the
 * dependencies that actually mean something.
 */
@Global()
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: APP_CONFIG,
      // Reading `process.env` exactly once, here, is what makes the rest of the
      // codebase testable: nothing else in `src/` touches it, so a test can
      // supply a config object instead of mutating global state.
      useFactory: (): AppConfig => loadConfig(),
    },
    PrismaService,
    EventBus,
    CursorService,
  ],
  exports: [APP_CONFIG, PrismaService, EventBus, CursorService],
})
export class CommonModule {}
