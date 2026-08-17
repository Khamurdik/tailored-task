import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client, as a Nest provider.
 *
 * Connecting in `onModuleInit` rather than lazily on the first query means a
 * bad `DATABASE_URL` fails the boot instead of the first request that happens
 * to need the database — the same argument as validating config at boot.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  /**
   * Nest calls this on `app.close()`, which `enableShutdownHooks` wires to
   * SIGTERM. Without it a rolling deploy leaves connections open on the old
   * instance — which matters more than usual against Neon, where an idle
   * connection is what stops the compute scaling to zero.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
