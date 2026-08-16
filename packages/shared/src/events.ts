import { z } from 'zod';

/**
 * The event payload contract. It lives in the shared package rather than in
 * `common` so that both ends of every listener compile against one definition
 * — an emitter and a handler that disagree about a payload is a class of bug
 * that a typed bus is supposed to make impossible, and cannot if each side
 * declares its own shape.
 *
 * Emitters and listeners, so the wiring is greppable in one place:
 *   user.created        seeder → sharing
 *   user.authenticated  auth   → sharing
 *   node.deleted        nodes  → sharing
 */

export const UserCreatedSchema = z.strictObject({
  userId: z.uuid(),
  email: z.email(),
});
export type UserCreated = z.infer<typeof UserCreatedSchema>;

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
  'user.created': UserCreatedSchema,
  'user.authenticated': UserAuthenticatedSchema,
  'node.deleted': NodeDeletedSchema,
} as const;

export type EventName = keyof typeof EVENT_SCHEMAS;

export type EventMap = {
  [K in EventName]: z.infer<(typeof EVENT_SCHEMAS)[K]>;
};
