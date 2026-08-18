import { CursorSchema } from '@dataroom/shared';
import { describe, expect, it } from 'vitest';

import { InvalidCursorError, decodeCursor, encodeCursor } from '@api/common/pagination/cursor';

const SECRET = 'test-cursor-secret-not-used-anywhere-else';

describe('cursors', () => {
  it('API-COMMON-010 a cursor round-trips to the same (type, name, id) tuple', () => {
    const payload = {
      type: 'folder',
      name: 'Договори',
      id: '11111111-1111-4111-8111-111111111111',
    };

    expect(decodeCursor(encodeCursor(payload, SECRET), SECRET)).toEqual(payload);

    // Non-ASCII is the case that matters: a cursor carries a sort key, and the
    // page boundary is exactly where an encoding bug shows up as silently
    // skipped or duplicated rows.
    for (const name of ['café', 'ĄŽ', '文件', 'a"b|c', '']) {
      const round = decodeCursor(encodeCursor({ ...payload, name }, SECRET), SECRET);
      expect(round.name).toBe(name);
    }
  });

  it('API-COMMON-011 a tampered cursor is rejected rather than decoded to garbage', () => {
    const cursor = encodeCursor(
      { type: 'file', name: 'a.pdf', id: '11111111-1111-4111-8111-111111111111' },
      SECRET,
    );

    // The token is payload bytes followed by a 32-byte digest, encoded once —
    // so tampering is done on the decoded bytes rather than by splitting on a
    // separator, which no longer exists. See `cursor.ts` for why.
    const raw = Buffer.from(cursor, 'base64url');
    const body = raw.subarray(0, raw.length - 32);
    const signature = raw.subarray(raw.length - 32);

    const forged = Buffer.from(JSON.stringify(['file', 'zzz', 'other-id']), 'utf8');
    const alteredSignature = Buffer.from(signature);
    alteredSignature[0] = (alteredSignature[0] ?? 0) ^ 0xff;

    const tampered = [
      // payload swapped, signature kept
      Buffer.concat([forged, signature]).toString('base64url'),
      // signature altered by one bit
      Buffer.concat([body, alteredSignature]).toString('base64url'),
      // signature removed
      body.toString('base64url'),
      // signature truncated
      Buffer.concat([body, signature.subarray(0, 16)]).toString('base64url'),
      'not-a-cursor',
      '',
    ];

    for (const candidate of tampered) {
      expect(() => decodeCursor(candidate, SECRET), candidate).toThrow(InvalidCursorError);
    }

    // A different key must not validate. This is what stops a cursor minted by
    // one deployment from being replayed against another.
    expect(() => decodeCursor(cursor, `${SECRET}-other`)).toThrow(InvalidCursorError);
  });

  it('API-COMMON-018 an emitted cursor is a valid CursorSchema value', () => {
    // The contract's claim about a cursor is that it is opaque **base64url**.
    // This asserts the encoder against that schema rather than against itself —
    // which is the gap that let `base64url(payload).base64url(hmac)` ship: the
    // round-trip test passes for any encoding the decoder happens to understand.
    const names = [
      'Звіт',
      'a.pdf',
      '',
      // At the cap, in a script where one character is three UTF-8 bytes. This
      // is the case that broke the original 512-character bound: the cursor for
      // it is roughly 1500 characters and there is nothing wrong with it.
      '契'.repeat(255),
      '文件 — Ärendehandlingar / Đầu tư',
    ];

    for (const name of names) {
      const cursor = encodeCursor(
        { type: 'folder', name, id: '11111111-1111-4111-8111-111111111111' },
        SECRET,
      );

      const parsed = CursorSchema.safeParse(cursor);
      expect(parsed.success, `${JSON.stringify(name.slice(0, 20))} → ${cursor.slice(0, 24)}…`).toBe(
        true,
      );

      // Still a working cursor, not merely a well-shaped string.
      expect(decodeCursor(cursor, SECRET).name).toBe(name);
    }
  });
});
