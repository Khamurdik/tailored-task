import type { Role } from '@dataroom/shared';

import type { NodeSnapshot } from './ports/node-lookup.port';
import { maxRole } from './role';

/**
 * Who the caller is, as far as authorization is concerned.
 *
 * `null` is a legitimate value, not an error: an anonymous visitor holding a
 * share token is a real caller, and `auth`'s `SessionGuard` returns null rather
 * than throwing for exactly that reason.
 */
export type Actor = { userId: string } | { shareId: string } | null;

/** A live grant, as the repository hands it over. */
export interface Grant {
  id: string;
  nodeId: string;
  role: Role;
  principalUserId: string | null;
}

export interface ResolveInput {
  actor: Actor;
  node: NodeSnapshot;
  /** Grants on the node itself and on every ancestor. Already filtered for liveness. */
  grants: readonly Grant[];
}

/**
 * **A pure function with no injected dependencies.**
 *
 * That is the point of the whole `access`/`sharing` split, and it is what makes
 * the full permission matrix a millisecond unit test rather than an e2e suite.
 * Three things it deliberately cannot do, each of which would have made it
 * impure:
 *
 *   - **it does not read a clock.** Expiry and revocation are excluded by the
 *     repository's SQL, so by the time a grant arrives here it is live by
 *     construction. That is why `API-ACCESS-007` asserts the query rather than
 *     this function, and why no test here needs a clock stub;
 *   - **it does not query the tree.** The ancestor chain and the
 *     `ancestorsDeleted` flag arrive on the snapshot;
 *   - **it does not know about HTTP.** Turning `none` into a 404 is the guard's
 *     job.
 */
export function resolveAccess(input: ResolveInput): Role {
  const { actor, node, grants } = input;

  /**
   * A deleted node, or one under a deleted ancestor, is readable by nobody —
   * including its owner.
   *
   * Checked first, so nothing below can grant past it. This is the second line
   * of defence behind atomic cascade delete: if that cascade ever became async,
   * this is what stops a stale grant resolving in the window.
   */
  if (node.deletedAt !== null || node.ancestorsDeleted) return 'none';

  if (actor === null) return 'none';

  if ('userId' in actor) {
    // Ownership comes from the tree, not from a grant. There is no grant that can
    // confer `owner` — the database refuses to store one — so this is the single
    // path to it.
    if (node.ownerId === actor.userId) return 'owner';

    // Only grants addressed to this user count. A grant still pending against an
    // email has no `principalUserId` and must not resolve for anyone.
    const mine = grants.filter((grant) => grant.principalUserId === actor.userId);
    return maxRole(...mine.map((grant) => grant.role));
  }

  /**
   * A share credential resolves **only** the grant it names, and only where that
   * grant applies: on its own node, or anywhere beneath it.
   *
   * Scoping to the presented grant is the property the product rests on. A token
   * for folder B must not read sibling folder C, and must not read B's parent —
   * so it is not enough to ask "is there a live grant on this chain?", which any
   * token in the room would satisfy.
   */
  const presented = grants.find((grant) => grant.id === actor.shareId);
  if (presented === undefined) return 'none';

  const applies = presented.nodeId === node.id || node.ancestorIds.includes(presented.nodeId);
  return applies ? presented.role : 'none';
}
