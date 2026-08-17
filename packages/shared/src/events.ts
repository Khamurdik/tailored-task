import { z } from 'zod';

/**
 * The event payload contract. It lives in the shared package rather than in
 * `common` so that both ends of every listener compile against one definition
 * — an emitter and a handler that disagree about a payload is a class of bug
 * that a typed bus is supposed to make impossible, and cannot if each side
 * declares its own shape.
 *
 * Emitters and listeners, so the wiring is greppable in one place:
 *   user.authenticated  auth  → sharing
 *   node.deleted        nodes → sharing
 *
 * ## `user.created` was specified and does not exist
 *
 * It was to be the fast path for binding pending share grants, emitted by the
 * seeder, with login-time claiming as the guarantee behind it. It cannot work:
 * `prisma db seed` spawns `node prisma/seed.ts` as its **own process**, while
 * the bus and its listener live inside the long-running API. An in-process
 * emitter has nothing to deliver to.
 *
 * The other provisioning route — a hand-written `INSERT` — emits nothing
 * either, and always did. So the event had no reachable emitter at all, and
 * login-time claiming is not the guarantee behind the mechanism; it is the
 * mechanism. Removed rather than left as a definition nobody can fire.
 *
 * See HANDOFF.md §3.13.
 */

export const UserAuthenticatedSchema = z.strictObject({
  userId: z.uuid(),
  email: z.email(),
});
export type UserAuthenticated = z.infer<typeof UserAuthenticatedSchema>;

/**
 * Known limitation: `nodeIds` is unbounded, so deleting a large room puts
 * every descendant id in one payload. Accepted for now — the fix when it hurts
 * is to name the subtree by its root and let the listener ask `nodes` for the
 * members.
 */
export const NodeDeletedSchema = z.strictObject({
  rootId: z.uuid(),
  nodeIds: z.array(z.uuid()),
});
export type NodeDeleted = z.infer<typeof NodeDeletedSchema>;

export const EVENT_SCHEMAS = {
  'user.authenticated': UserAuthenticatedSchema,
  'node.deleted': NodeDeletedSchema,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;

export type EventMap = {
  [K in EventName]: z.infer<(typeof EVENT_SCHEMAS)[K]>;
};
