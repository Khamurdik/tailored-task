import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError, type RequestActor } from '../common';
import { NODE_LOOKUP, type NodeLookupPort } from './ports/node-lookup.port';
import { resolveAccess, type Actor } from './resolve-access';
import { ShareCodec } from './share-codec';
import { SharesRepository } from './shares.repository';
import { satisfies, type Verb } from './role';

export const REQUIRE_ACCESS = 'access:verb';

/** `@RequireAccess('read' | 'write' | 'own')` on a route that names a node. */
export function RequireAccess(verb: Verb): CustomDecorator<string> {
  return SetMetadata(REQUIRE_ACCESS, verb);
}

@Injectable()
export class NodeAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(NODE_LOOKUP) private readonly nodes: NodeLookupPort,
    private readonly shares: SharesRepository,
    private readonly codec: ShareCodec,
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
    const nodeId = this.nodeIdFrom(request);

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
    if (nodeId === null) throw AppError.notFound();

    const snapshot = await this.nodes.findSnapshot(nodeId);
    if (snapshot === null) throw AppError.notFound();

    // Self and every ancestor, in one query. Depth costs nothing here: the
    // ancestor ids were already known before any grant was fetched.
    const grants = await this.shares.liveGrantsFor([...snapshot.ancestorIds, snapshot.id]);
    const actor = await this.toResolverActor(request.actor ?? null);
    const role = resolveAccess({ actor, node: snapshot, grants });

    if (!satisfies(role, verb)) throw AppError.notFound();

    request.access = {
      nodeId: snapshot.id,
      role,
      rootId: snapshot.rootId,
      ownerId: snapshot.ownerId,
    };
    return true;
  }

  /**
   * Turns the raw credential `auth` attached into the grant id the resolver
   * needs.
   *
   * This translation is the boundary in action: `auth` says "someone presented
   * this string", and `access` — the only module that may read `shares` — says
   * which grant that is. An unresolvable credential becomes `null`, so unknown,
   * revoked and expired are indistinguishable here too.
   */
  private async toResolverActor(actor: RequestActor): Promise<Actor> {
    if (actor === null) return null;
    if ('userId' in actor) return { userId: actor.userId };

    const share = await this.shares.findLiveByCredentialHash(
      this.codec.hash(actor.shareToken),
    );
    return share === null ? null : { shareId: share.id };
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
