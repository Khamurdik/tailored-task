import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { ZodValidationPipe } from 'nestjs-zod';

import { AppModule } from './app.module';
import { APP_CONFIG, ErrorFilter, type AppConfig } from './common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);

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
   * One definition, both sides, and the API validates against exactly what the
   * client was told.
   */
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new ErrorFilter());

  // Lets `onModuleDestroy` run on SIGTERM, so Prisma disconnects on a rolling
  // deploy rather than leaving the old instance holding connections open.
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('bootstrap').log(`API listening on :${config.port} (${config.env})`);
}

void bootstrap();
