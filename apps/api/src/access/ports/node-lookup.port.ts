export const NODE_LOOKUP = Symbol('NODE_LOOKUP');

/**
 * What `access` needs to know about a node, and nothing more.
 *
 * `access` needs a node's ancestor chain to resolve inherited grants; `nodes`
 * controllers need the access guard. That is a genuine cycle, and this port is
 * how it is broken: `access` declares the shape and **never imports `nodes`**.
 * `NodesRepository` satisfies it, and the binding happens once in `AppModule`.
 *
 * There is no `forwardRef` anywhere in this codebase. If one starts to look
 * necessary, a boundary is wrong.
 */
export interface NodeSnapshot {
  id: string;
  rootId: string;
  ownerId: string;

  /**
   * Ancestors, root first, **excluding self**.
   *
   * A list rather than a delimited path, because the ancestor chain is a fact
   * about the tree while a path is one way of storing it. `nodes` currently uses
   * a materialized path; nothing here knows that, so a change of strategy cannot
   * reach the resolver.
   */
  ancestorIds: readonly string[];

  deletedAt: Date | null;

  /**
   * True if ANY ancestor is soft-deleted.
   *
   * This is what makes the deleted-ancestor rule computable at all. `access` must
   * return `none` when the target *or any ancestor* is deleted, and a snapshot
   * carrying only its own `deletedAt` leaves the ancestor half unanswerable — the
   * resolver is a pure function, so it cannot go and look. One extra boolean,
   * computed by the repository in the query that already reads the node, keeps
   * the resolver pure and the invariant true.
   */
  ancestorsDeleted: boolean;
}

export interface NodeLookupPort {
  findSnapshot(id: string): Promise<NodeSnapshot | null>;
}
