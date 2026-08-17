import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AccessModule } from '../access';
import { AuthModule } from '../auth';
import { FilesModule } from '../files';
import { NodesModule } from '../nodes';
import { UsersModule } from '../users';
import { AdminGuard } from './admin.guard';
import { JobRunner } from './job-runner.service';
import { JobRunsRepository } from './job-runs.repository';
import { JobRegistry } from './job.registry';
import { JobScheduler } from './job-scheduler.service';
import { JobsController } from './jobs.controller';

/**
 * L4. Scheduled work, exposed as inspectable objects.
 *
 * **Nothing imports this module.** It reaches down into `files`, `nodes`,
 * `access`, `auth` and `users`; nothing reaches in. That is what makes it safe
 * for it to depend on everything — and it exports nothing for the same reason.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    FilesModule,
    NodesModule,
    AccessModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [JobsController],
  providers: [JobRunsRepository, JobRegistry, JobRunner, JobScheduler, AdminGuard],
})
export class JobsModule {}
