import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The keyset cursor.
 *
 * It encodes the `(type, name, id)` tuple the listing orders by, base64url, and
 * signs it. Opaque to the client — the moment a client can read a cursor, the
 * server can no longer change how it paginates.
 *
 * ## Why it is signed and not just encoded
 *
 * A cursor is a value the client hands back and the server puts into a `WHERE`
 * clause. Unsigned, a caller can craft one and page through positions they were
 * never given — and because the tuple includes a name, a crafted cursor is a
 * way to probe *whether a name exists* in a folder without listing it. The HMAC
 * turns "decoded to something plausible" into "rejected".
 *
 * It is not encryption: the payload is readable to anyone who base64-decodes
 * it. That is fine. The tuple describes a row the caller was already shown; the
 * property being defended is integrity, not secrecy.
 */

export interface CursorPayload {
  /** Sort key parts, in the same order as the `ORDER BY`. */
  readonly type: string;
  readonly name: string;
  readonly id: string;
}

export class InvalidCursorError extends Error {
  constructor(reason: string) {
    super(`Invalid cursor: ${reason}`);
    this.name = 'InvalidCursorError';
  }
}

const SEPARATOR = '.';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(
    JSON.stringify([payload.type, payload.name, payload.id]),
    'utf8',
  ).toString('base64url');

  return `${body}${SEPARATOR}${sign(body, secret)}`;
}

export function decodeCursor(cursor: string, secret: string): CursorPayload {
  const separator = cursor.lastIndexOf(SEPARATOR);
  if (separator <= 0) throw new InvalidCursorError('missing signature');

  const body = cursor.slice(0, separator);
  const presented = cursor.slice(separator + 1);
  const expected = sign(body, secret);

  // Length check first: timingSafeEqual throws on a length mismatch rather
  // than returning false, and a thrown RangeError here would read as a bug.
  if (presented.length !== expected.length) throw new InvalidCursorError('signature mismatch');
  if (!timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) {
    throw new InvalidCursorError('signature mismatch');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError('payload is not valid JSON');
  }

  if (
    !Array.isArray(decoded) ||
    decoded.length !== 3 ||
    !decoded.every((part) => typeof part === 'string')
  ) {
    throw new InvalidCursorError('payload is not a [type, name, id] tuple');
  }

  const [type, name, id] = decoded as [string, string, string];
  return { type, name, id };
}
