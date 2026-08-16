import { z } from 'zod';

/**
 * Ascending. `max(role)` across a node and its ancestors is an ordinal
 * maximum, which is why this is declared in this order and not alphabetically.
 *
 * `editor` is defined and never issued. Adding per-user roles later is then a
 * data change rather than a schema change, and that should be visibly true in
 * the code rather than asserted in a README.
 */
export const RoleSchema = z.enum(['none', 'viewer', 'editor', 'owner']);
export type Role = z.infer<typeof RoleSchema>;

export const ShareKindSchema = z.enum(['public_link', 'user']);
export type ShareKind = z.infer<typeof ShareKindSchema>;

export const CreateShareRequestSchema = z
  .strictObject({
    kind: ShareKindSchema,
    /** Required for `user` grants, forbidden for links. May not have an account yet. */
    email: z.email().optional(),
    role: RoleSchema.exclude(['none', 'owner']).default('viewer'),
    expiresAt: z.iso.datetime().nullable().default(null),
    /**
     * Mint a 16-character short code alongside the 43-character token.
     *
     * Off by default on purpose: a grant is only as strong as its weakest
     * credential, and a short code takes this share from 256 bits to 80. That
     * is still unguessable, but it is not a trade to make on every share
     * silently.
     */
    shortLink: z.boolean().default(false),
  })
  .refine((v) => (v.kind === 'user') === (v.email !== undefined), {
    error: 'email is required for a user grant and not allowed for a link',
    path: ['email'],
  });
export type CreateShareRequest = z.infer<typeof CreateShareRequestSchema>;

/**
 * `inheritedFrom` is what lets an owner answer "why is this exposed?" — a
 * grant list that shows only direct grants makes inherited access invisible
 * exactly where it matters.
 */
export const ShareSummarySchema = z.strictObject({
  id: z.uuid(),
  nodeId: z.uuid(),
  kind: ShareKindSchema,
  role: RoleSchema,
  principalEmail: z.email().nullable(),
  hasShortCode: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  inheritedFrom: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
});
export type ShareSummary = z.infer<typeof ShareSummarySchema>;

/**
 * The only response in the system that carries a plaintext credential, and it
 * carries it exactly once — there is no endpoint that reads a token back.
 */
export const CreatedShareSchema = z.strictObject({
  share: ShareSummarySchema,
  token: z.string(),
  shortCode: z.string().nullable(),
});
export type CreatedShare = z.infer<typeof CreatedShareSchema>;

/**
 * What an anonymous visitor gets for a valid credential. No node name, no
 * type, no child count: every fact about the tree must come through the same
 * guard an owner's request goes through, so the client fetches the node
 * separately with the same header.
 */
export const ResolveShareResponseSchema = z.strictObject({
  rootNodeId: z.uuid(),
  role: RoleSchema,
  expiresAt: z.iso.datetime().nullable(),
});
export type ResolveShareResponse = z.infer<typeof ResolveShareResponseSchema>;
