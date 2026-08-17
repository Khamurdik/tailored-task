import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { APP_CONFIG, type AppConfig } from './common';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  // Helmet, CORS, the zod pipe, the error filter and shutdown hooks all live in
  // `app.setup.ts` so the integration harness applies the identical set. A test
  // that configures its own subset is a test of a composition that does not
  // exist in production.
  configureApp(app, config);

  await app.listen(config.port);
  new Logger('bootstrap').log(`API listening on :${config.port} (${config.env})`);
}

void bootstrap();
