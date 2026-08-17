import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../common';
import { UsersService } from '../users';

/**
 * Admin-only, and **404 for everyone else**.
 *
 * These endpoints expose deletion counts across every room and can trigger a
 * hard delete. They are not node-scoped, so `NodeAccessGuard` has nothing to say
 * about them and this is the whole authorization.
 *
 * A non-admin gets 404 rather than 403, consistent with the rest of the system —
 * and an anonymous caller gets 404 rather than 401, which is the one place this
 * guard deliberately differs from `@RequireAuth()`. The existence of an admin
 * surface is not something an unauthenticated caller needs confirmed.
 *
 * `is_admin` is a column set only by the seeder. There is no endpoint that
 * grants it and no way for a user to escalate into it.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly users: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const actor = request.actor ?? null;

    // One exit, constructed one way — anonymous, share-scoped, non-existent and
    // merely-not-admin are indistinguishable.
    if (actor === null || !('userId' in actor)) throw AppError.notFound();

    const user = await this.users.findById(actor.userId);
    if (user === null || !user.isAdmin) throw AppError.notFound();

    return true;
  }
}
