import { z } from 'zod';

import { MAX_NAME_LENGTH, PAGE_SIZE } from './constants.js';

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
/**
 * The bound is derived rather than picked, because the obvious round number is
 * too small.
 *
 * A cursor carries the sort key, and the sort key contains a **name** — up to
 * `MAX_NAME_LENGTH` characters, which is 255 *characters* and therefore up to
 * 1020 bytes once a Cyrillic or CJK name is UTF-8 encoded. Add the type, the
 * uuid, the JSON punctuation and a 32-byte signature, then base64url the lot,
 * and the longest legitimate cursor is around 1500 characters.
 *
 * The original `512` would have rejected a perfectly valid cursor for any
 * folder whose 50th child had a long non-ASCII name — pagination failing only
 * on the second page, only in some folders, only in some languages. Sized off
 * the constant so it cannot drift if `MAX_NAME_LENGTH` moves.
 */
const MAX_CURSOR_LENGTH = Math.ceil(((MAX_NAME_LENGTH * 4 + 96) / 3) * 4);

export const CursorSchema = z.base64url().max(MAX_CURSOR_LENGTH);

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
