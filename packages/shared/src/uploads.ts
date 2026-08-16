import { z } from 'zod';

import { MAX_FILE_SIZE } from './constants.js';
import { NodeNameSchema } from './nodes.js';

/**
 * `sizeBytes` and `contentType` are the client's *claim*. They are checked
 * here so a doomed upload fails before a byte moves, and they are pinned into
 * the presigned PUT signature — but `/complete` takes the authoritative values
 * from `HeadObject`, never from this request.
 */
export const InitUploadRequestSchema = z.strictObject({
  parentId: z.uuid(),
  name: NodeNameSchema,
  sizeBytes: z.int().positive().max(MAX_FILE_SIZE),
  contentType: z.string().min(1).max(255),
});
export type InitUploadRequest = z.infer<typeof InitUploadRequestSchema>;

/**
 * `finalName` may differ from the requested name: the node row is inserted as
 * `pending` at init, so the conflict is resolved — and the name reserved — for
 * the whole upload window rather than at `/complete`, when the bytes are
 * already spent.
 */
export const InitUploadResponseSchema = z.strictObject({
  nodeId: z.uuid(),
  uploadUrl: z.url(),
  finalName: z.string(),
});
export type InitUploadResponse = z.infer<typeof InitUploadResponseSchema>;

/**
 * Deliberately empty. Everything `/complete` needs it reads from S3; anything
 * a client could put here would be a value the server must then distrust.
 * Strict, so a client that starts sending a size gets a 400 instead of having
 * it silently ignored.
 */
export const CompleteUploadRequestSchema = z.strictObject({});
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequestSchema>;

/**
 * Short-lived by construction — 60 seconds. A presigned GET cannot be revoked
 * once issued, so `expiresAt` is the entire mitigation and the client must
 * treat the URL as single-use rather than caching it.
 */
export const ContentUrlResponseSchema = z.strictObject({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type ContentUrlResponse = z.infer<typeof ContentUrlResponseSchema>;
