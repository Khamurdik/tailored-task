import { describe, expect, it } from 'vitest';

import { InvalidCursorError, decodeCursor, encodeCursor } from '@api/common/pagination/cursor';

const SECRET = 'test-cursor-secret-not-used-anywhere-else';

describe('cursors', () => {
  it('API-COMMON-010 a cursor round-trips to the same (type, name, id) tuple', () => {
    const payload = {
      type: 'folder',
      name: 'Договоры',
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

    const [body = '', signature = ''] = cursor.split('.');
    const forged = Buffer.from(JSON.stringify(['file', 'zzz', 'other-id']), 'utf8').toString(
      'base64url',
    );

    const tampered = [
      `${forged}.${signature}`, // payload swapped, signature kept
      `${body}.${signature.slice(0, -1)}A`, // signature altered
      body, // signature removed
      `${body}.`, // signature emptied
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
});
