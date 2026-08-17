import { ancestorIdsOf, ancestorsDeleted, mockDb, type MockNode } from './db';
import type { Actor } from './session';

/**
 * The only authorisation this mock performs.
 *
 * Two rules, both of which the front end genuinely depends on:
 *
 *   - an **owner** sees their own rooms;
 *   - a **share token** sees the node it was granted on and that node's
 *     descendants, and nothing else.
 *
 * The full role matrix is `access`'s job and is deliberately not reproduced
 * here. Copying it would create the second implementation of the permission
 * rules that the pure-resolver design exists to prevent — and the copy would be
 * the one nobody updates. What is modelled is exactly what `public-view` and
 * `explorer` need to be built honestly.
 */
export function canRead(actor: Actor, node: MockNode): boolean {
  const nodes = mockDb().nodes;

  // A deleted node, or one under a deleted ancestor, is readable by nobody.
  // Second line of defence behind cascade delete, same as the real resolver.
  if (node.deletedAt !== null || ancestorsDeleted(nodes, node.id)) return false;

  if (actor === null) return false;

  if (actor.kind === 'user') return node.ownerId === actor.user.id;

  const scope = actor.share.nodeId;
  return node.id === scope || ancestorIdsOf(nodes, node.id).includes(scope);
}

/** Owner-only. Sharing, renaming, deleting and uploading all route through this. */
export function canWrite(actor: Actor, node: MockNode): boolean {
  return actor?.kind === 'user' && canRead(actor, node);
}

/**
 * Read a node or explain nothing. Returns `null` for both "no such node" and
 * "not yours", so the caller has only one branch to write and cannot
 * accidentally produce two distinguishable responses.
 */
export function readable(actor: Actor, nodeId: string): MockNode | null {
  const node = mockDb().nodes.get(nodeId);
  if (node === undefined) return null;
  return canRead(actor, node) ? node : null;
}

export function writable(actor: Actor, nodeId: string): MockNode | null {
  const node = mockDb().nodes.get(nodeId);
  if (node === undefined) return null;
  return canWrite(actor, node) ? node : null;
}
