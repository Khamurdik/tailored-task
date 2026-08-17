import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';

import { ErrorFilter, type AppConfig } from './common';

/**
 * Everything applied to the application object rather than to a module.
 *
 * ## Why this is its own file
 *
 * The same reason the integration harness boots `AppModule` instead of listing
 * modules: **a second copy of the composition drifts, and the drift is silent.**
 * When this lived in `main.ts`, a test could only get it by duplicating it — and
 * a duplicate that forgets `ErrorFilter` turns every `AppError` into a 500, so a
 * suite asserting "denial is 404" would fail for a reason that has nothing to do
 * with the code under test. Worse in the other direction: a suite that
 * *duplicated* the filter correctly would keep passing after `main.ts` changed.
 *
 * `main.ts` cannot be imported by a test to get at it, because it calls
 * `bootstrap()` at module scope — importing it would start a listening server.
 * Hence a file that holds the configuration and nothing that runs.
 */
export function configureApp(app: INestApplication, config: AppConfig): INestApplication {
  app.use(helmet());

  /**
   * Uncredentialed CORS, with an exact-match origin list.
   *
   * `credentials` stays false because this API sets no cookies and the client
   * sends none — which is what removes CSRF as a category and deletes the
   * `SameSite=None` problem a Vercel-plus-App-Runner split would otherwise
   * force. Turning it on later is not a config tweak; it is a change of
   * security model.
   */
  app.enableCors({
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    credentials: false,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Share-Token'],
    exposedHeaders: ['ETag'],
  });

  /**
   * `ZodValidationPipe`, not Nest's `ValidationPipe`.
   *
   * The built-in one is a `class-validator` front end and throws
   * "The class-validator package is missing" at boot without it — which is
   * where this was found. Installing that package would also mean maintaining a
   * second set of DTO definitions with a second set of rules, when
   * `packages/shared` already holds the schemas both ends compile against.
   */
  app.useGlobalPipes(new ZodValidationPipe());

  // The single exit for every error. Without it an `AppError` surfaces as a
  // Nest 500 and every "denial is 404" assertion fails for the wrong reason.
  app.useGlobalFilters(new ErrorFilter());

  // Lets `onModuleDestroy` run on SIGTERM, so Prisma disconnects on a rolling
  // deploy rather than leaving the old instance holding connections open.
  app.enableShutdownHooks();

  return app;
}
