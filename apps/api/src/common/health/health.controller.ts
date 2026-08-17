import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Two health endpoints, and the difference between them is the whole point.
 */
@Controller('health')
// App Runner polls `/health` about every ten seconds. Throttling it is how an
// instance gets marked unhealthy by its own rate limiter.
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * **No I/O. Ever.**
   *
   * App Runner polls this roughly every 10 seconds. A database query here means
   * the connection is never idle, which means Neon never scales to zero, which
   * burns the free-tier compute quota in about two weeks. The cost of getting
   * this wrong is invisible locally and invisible in staging — it shows up as a
   * bill, or as a dead environment, weeks later.
   *
   * `API-COMMON-014` asserts it with a query spy rather than by inspection, for
   * exactly that reason.
   */
  @Get()
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * The one that does touch the database. Nothing polls it; it is for a human
   * or a deploy step asking whether this instance can actually serve.
   */
  @Get('deep')
  async readiness(): Promise<{ status: 'ok' | 'degraded'; database: 'up' | 'down' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
