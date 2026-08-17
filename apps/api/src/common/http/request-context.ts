import type { Role } from '@dataroom/shared';

/**
 * What the guards attach to a request, declared in L0.
 *
 * It lives here because **both `auth` and `access` need it and neither may
 * import the other** — they are the same layer, and `auth` reading a share grant
 * would collapse the authn/authz split the design rests on. This is the shape of
 * an HTTP request rather than a domain concept, which is exactly what `common`
 * is for.
 */

/**
 * Who is calling, as `auth` can determine it without reading a grant.
 *
 * `{ shareToken }` is the raw credential. Resolving it to a grant is `access`'s
 * job; if `auth` did it, `auth` would depend on `access`.
 */
export type RequestActor = { userId: string } | { shareToken: string } | null;

/** What `access` resolved, for the controller below it. */
export interface AccessContext {
  nodeId: string;
  role: Role;
  rootId: string;
  ownerId: string;
}

declare module 'express' {
  interface Request {
    /** Set by `SessionGuard`. `null` is a legitimate value — see the guard. */
    actor?: RequestActor;
    /** Set by `NodeAccessGuard` on node-scoped routes only. */
    access?: AccessContext;
  }
}
