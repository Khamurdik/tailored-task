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
 *
 * ## Why the signature is appended as bytes rather than joined with a `.`
 *
 * The first version emitted `base64url(payload) + '.' + base64url(hmac)`, which
 * is the familiar JWT-ish shape and is **not a valid `CursorSchema` value**: the
 * shared contract declares a cursor as `z.base64url()`, and `.` is not in that
 * alphabet. Every cursor this module produced would have been rejected by the
 * client's own response parsing.
 *
 * Nothing caught it for the obvious reason — until the children listing existed
 * there was no caller, so `encodeCursor` had never been asked for a cursor that
 * anything downstream then validated. The unit tests round-tripped it against
 * itself and were perfectly happy.
 *
 * So the payload and its 32-byte digest are concatenated as raw bytes and
 * encoded **once**. The result is a single base64url token, which is what the
 * contract says a cursor is, and it is shorter than the two-part form as well.
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

/** SHA-256, so the digest is a fixed 32 bytes and the split point is known. */
const SIGNATURE_BYTES = 32;

function sign(body: Buffer, secret: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function encodeCursor(payload: CursorPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify([payload.type, payload.name, payload.id]), 'utf8');

  return Buffer.concat([body, sign(body, secret)]).toString('base64url');
}

export function decodeCursor(cursor: string, secret: string): CursorPayload {
  // `base64url` decoding is lenient — it ignores characters outside the
  // alphabet rather than failing — so a malformed cursor has to be caught by
  // the signature check below rather than by the decode itself.
  const raw = Buffer.from(cursor, 'base64url');
  if (raw.length <= SIGNATURE_BYTES) throw new InvalidCursorError('too short to carry a signature');

  const body = raw.subarray(0, raw.length - SIGNATURE_BYTES);
  const presented = raw.subarray(raw.length - SIGNATURE_BYTES);
  const expected = sign(body, secret);

  // Lengths are equal by construction here, but `timingSafeEqual` throws rather
  // than returning false on a mismatch, and a RangeError escaping this function
  // would read as a bug rather than as a rejected cursor.
  if (presented.length !== expected.length) throw new InvalidCursorError('signature mismatch');
  if (!timingSafeEqual(presented, expected)) throw new InvalidCursorError('signature mismatch');

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.toString('utf8'));
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
