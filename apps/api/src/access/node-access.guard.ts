import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../common';
import { NodeAccessResolver } from './node-access.resolver';
import { type Verb } from './role';

export const REQUIRE_ACCESS = 'access:verb';

/** `@RequireAccess('read' | 'write' | 'own')` on a route that names a node. */
export function RequireAccess(verb: Verb): CustomDecorator<string> {
  return SetMetadata(REQUIRE_ACCESS, verb);
}

/**
 * The HTTP adapter over `NodeAccessResolver`.
 *
 * All this does is find the node id in the route, ask the resolver, and turn a
 * `null` into a 404. The decision itself lives in the resolver because two
 * operations name a node in the request **body** — folder creation names its
 * parent, a move names its destination — and a guard cannot see those. One
 * implementation, two callers; see the resolver's own comment.
 */
@Injectable()
export class NodeAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: NodeAccessResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const verb = this.reflector.getAllAndOverride<Verb | undefined>(REQUIRE_ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No decorator means the route is not node-scoped. It is not a route that
    // forgot — `jobs` and `auth` genuinely have no node — so this guard has
    // nothing to say about it.
    if (verb === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();

    /**
     * **Every failure below is the same 404.**
     *
     * Missing id, malformed id, nonexistent node, deleted node, insufficient
     * role — one exit, constructed one way. A 403 anywhere here would confirm
     * that an id exists, which is an enumeration oracle across every room in the
     * system; and two 404s with different bodies leak the same thing more
     * quietly. `API-ACCESS-011` asserts they are byte-identical, which is only
     * achievable because there is a single `throw` site.
     */
    const resolved = await this.access.resolve(
      request.actor ?? null,
      this.nodeIdFrom(request),
      verb,
    );
    if (resolved === null) throw AppError.notFound();

    request.access = resolved;
    return true;
  }

  /**
   * The node id from the route.
   *
   * `:id` and `:nodeId` are both accepted because a nested route reads better as
   * `/nodes/:nodeId/shares` while a top-level one reads better as `/nodes/:id` —
   * and a guard that only understood one would silently pass every route using
   * the other, which is the worst possible failure mode for an authorization
   * guard. Anything else is a 404 rather than a crash.
   */
  private nodeIdFrom(request: Request): string | null {
    const params = request.params as Record<string, string | undefined>;
    const candidate = params['id'] ?? params['nodeId'] ?? null;
    return candidate === undefined || candidate === '' ? null : candidate;
  }
}
