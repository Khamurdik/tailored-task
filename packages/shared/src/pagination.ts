import { z } from 'zod';

import { PAGE_SIZE } from './constants.js';

/**
 * A cursor is an opaque token, not a structure. Its encoding is `common`'s
 * business; the contract's only claim is that a client receives one and hands
 * it back unmodified.
 *
 * Validating the shape here rather than just `z.string()` means a tampered
 * cursor is a 400 at the pipe instead of a decode error deeper in — which
 * matters because a mangled cursor is far more often a bug in a caller than an
 * attack.
 */
export const CursorSchema = z.base64url().max(512);

export type Cursor = z.infer<typeof CursorSchema>;

export const PageQuerySchema = z.strictObject({
  cursor: CursorSchema.optional(),
  limit: z.int().min(1).max(PAGE_SIZE).default(PAGE_SIZE),
});

export type PageQuery = z.infer<typeof PageQuerySchema>;

/**
 * `nextCursor` is null on the last page — never an empty string, which reads
 * as "there is more" to a truthiness check and is the classic pagination bug.
 */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: CursorSchema.nullable(),
  });
