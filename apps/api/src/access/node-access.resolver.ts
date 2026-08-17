import { Inject, Injectable } from '@nestjs/common';

import type { AccessContext, RequestActor } from '../common';
import { NODE_LOOKUP, type NodeLookupPort } from './ports/node-lookup.port';
import { resolveAccess, type Actor } from './resolve-access';
import { SharesRepository } from './shares.repository';
import { satisfies, type Verb } from './role';

/**
 * Answers "may this caller do `verb` to this node?" — once, for everybody.
 *
 * ## Why this is a service and not just the guard's private method
 *
 * A guard can only see the route's own parameters, and two operations in this
 * system name a node the route does not carry: creating a folder names its
 * parent in the body, and moving a node names its **destination** in the body.
 * `NodeAccessGuard` cannot authorize either of those, so a controller has to.
 *
 * The moment a controller does its own check, there are two implementations of
 * the most security-critical decision in the system, and the second one is
 * where the subtle divergence lives — it forgets `ancestorsDeleted`, or it
 * resolves a share credential to *any* live grant rather than the one the caller
 * named. `links/TODO.md` makes exactly this argument about controllers holding
 * opposite defaults.
 *
 * So there is one implementation and two callers. The guard is a thin adapter
 * that turns `null` into a 404; a controller calls the same method for the node
 * its route could not name.
 *
 * Everything that made the guard's version safe is preserved here:
 *
 *   - **one shape of failure.** Missing id, malformed id, nonexistent node,
 *     deleted node, deleted ancestor, and insufficient role all return `null`.
 *     Callers cannot tell them apart, so they cannot leak the difference;
 *   - **the grant the caller named**, never any grant that happens to apply.
 *     An unresolvable credential becomes an anonymous actor rather than an
 *     error, so unknown, revoked and expired stay indistinguishable;
 *   - **self and every ancestor in one query**, regardless of depth.
 */
@Injectable()
export class NodeAccessResolver {
  constructor(
    @Inject(NODE_LOOKUP) private readonly nodes: NodeLookupPort,
    private readonly shares: SharesRepository,
  ) {}

  /**
   * `null` means "no", for every reason there is.
   *
   * Deliberately not a thrown error: throwing here would put a second `throw`
   * site in the codebase for denial, and `API-ACCESS-011` requires every denial
   * to be byte-identical — which is only achievable when there is one place that
   * constructs it. Callers turn `null` into `AppError.notFound()`.
   */
  async resolve(
    actorFromRequest: RequestActor,
    nodeId: string | null | undefined,
    verb: Verb,
  ): Promise<AccessContext | null> {
    if (nodeId === null || nodeId === undefined || nodeId === '') return null;

    const snapshot = await this.nodes.findSnapshot(nodeId);
    if (snapshot === null) return null;

    // Self and every ancestor, in one query. Depth costs nothing here: the
    // ancestor ids were already known before any grant was fetched.
    const grants = await this.shares.liveGrantsFor([...snapshot.ancestorIds, snapshot.id]);
    const actor = await this.toResolverActor(actorFromRequest);
    const role = resolveAccess({ actor, node: snapshot, grants });

    if (!satisfies(role, verb)) return null;

    return {
      nodeId: snapshot.id,
      role,
      rootId: snapshot.rootId,
      ownerId: snapshot.ownerId,
      /**
       * Where this visitor's reach begins, for a share actor.
       *
       * Read out of the grants already fetched above rather than queried, and
       * only for the grant the caller **named** — the same scoping rule
       * `resolveAccess` applies, so the two cannot disagree about which grant is
       * in play. A controller uses it to stop a breadcrumb trail at the shared
       * node instead of at the room, which is what keeps the folders above a
       * share out of a visitor's view (`WEB-PUBLICVIEW-003`).
       */
      grantNodeId:
        actor !== null && 'shareId' in actor
          ? (grants.find((grant) => grant.id === actor.shareId)?.nodeId ?? null)
          : null,
    };
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

    const share = await this.shares.findLiveByCredential(actor.shareToken);
    return share === null ? null : { shareId: share.id };
  }
}
