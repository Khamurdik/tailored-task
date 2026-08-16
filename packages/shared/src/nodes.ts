import { z } from 'zod';

import { MAX_NAME_LENGTH } from './constants.js';
import { CursorSchema } from './pagination.js';

export const NodeTypeSchema = z.enum(['room', 'folder', 'file']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

/** `pending` is an upload in flight. `files` owns the transition. */
export const NodeStateSchema = z.enum(['pending', 'active']);
export type NodeState = z.infer<typeof NodeStateSchema>;

/**
 * Names are normalized and sanitized server-side before they are stored, so
 * this bound is the client's early warning rather than the enforcement. The
 * cap is in characters after NFC normalization — `é` composed is one character
 * and decomposed is two, and only one of those readings can be the limit.
 */
export const NodeNameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

export const BreadcrumbSchema = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  type: NodeTypeSchema,
});
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;

/**
 * What a list row needs, and nothing more. `subtreeFiles` / `subtreeBytes` are
 * the denormalized rollups; they are null on files, where they would only
 * restate `sizeBytes`.
 */
export const NodeSummarySchema = z.strictObject({
  id: z.uuid(),
  type: NodeTypeSchema,
  name: z.string(),
  state: NodeStateSchema,
  sizeBytes: z.int().nonnegative().nullable(),
  contentType: z.string().nullable(),
  subtreeFiles: z.int().nonnegative().nullable(),
  subtreeBytes: z.int().nonnegative().nullable(),
  updatedAt: z.iso.datetime(),
});
export type NodeSummary = z.infer<typeof NodeSummarySchema>;

/**
 * Note what is absent: there is no `path`, and there is no ancestor id list.
 * How `nodes` stores ancestry is that module's private business, and a
 * breadcrumb trail is the only part of it a client has any use for.
 */
export const NodeDetailSchema = NodeSummarySchema.extend({
  rootId: z.uuid(),
  parentId: z.uuid().nullable(),
  depth: z.int().nonnegative(),
  breadcrumbs: z.array(BreadcrumbSchema),
  createdAt: z.iso.datetime(),
});
export type NodeDetail = z.infer<typeof NodeDetailSchema>;

/**
 * Breadcrumbs ride along with the page rather than being a second request:
 * `nodes` resolves the ancestor chain to answer the query anyway.
 */
export const ChildrenPageSchema = z.strictObject({
  items: z.array(NodeSummarySchema),
  nextCursor: CursorSchema.nullable(),
  breadcrumbs: z.array(BreadcrumbSchema),
});
export type ChildrenPage = z.infer<typeof ChildrenPageSchema>;

export const CreateRoomRequestSchema = z.strictObject({
  name: NodeNameSchema,
});
export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;

export const CreateFolderRequestSchema = z.strictObject({
  parentId: z.uuid(),
  name: NodeNameSchema,
});
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>;

export const RenameNodeRequestSchema = z.strictObject({
  name: NodeNameSchema,
});
export type RenameNodeRequest = z.infer<typeof RenameNodeRequestSchema>;

export const MoveNodeRequestSchema = z.strictObject({
  parentId: z.uuid(),
});
export type MoveNodeRequest = z.infer<typeof MoveNodeRequestSchema>;

/** Live aggregate, used to make a delete confirmation truthful. */
export const NodeStatsSchema = z.strictObject({
  files: z.int().nonnegative(),
  folders: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
});
export type NodeStats = z.infer<typeof NodeStatsSchema>;
