import { describe, expect, it } from 'vitest';

import { CROCKFORD, ShareCodec, SHORT_CODE_LENGTH } from '@api/access';

/**
 * The credential format, tested without a database.
 *
 * `ShareCodec` lives in `access` and is exercised here because the **format** is
 * specified by `links` — that module has to parse whatever `sharing` mints, and
 * if either owned the format the other would be importing sideways within L3.
 */
const codec = new ShareCodec();

describe('short code format and minting', () => {
  it('API-LINKS-007 a minted short code is 16 Crockford base32 characters', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const code = codec.mintShortCode();
      expect(code).toHaveLength(SHORT_CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
      for (const character of code) expect(CROCKFORD).toContain(character);
    }
  });

  it('API-LINKS-008 a minted short code never contains I, L, O, or U', () => {
    // `I`, `L` and `O` are excluded so a code read off a screen and retyped
    // cannot land on a *different valid code* by transcription; `U` is excluded
    // to keep accidental words out of codes people paste into email.
    const forbidden = /[ILOU]/;
    expect(CROCKFORD).not.toMatch(forbidden);

    for (let attempt = 0; attempt < 2000; attempt += 1) {
      expect(codec.mintShortCode()).not.toMatch(forbidden);
    }
  });

  it('API-LINKS-009 two thousand mints produce two thousand distinct codes', () => {
    const codes = new Set<string>();
    for (let attempt = 0; attempt < 2000; attempt += 1) codes.add(codec.mintShortCode());

    // 80 bits: a collision in 2000 draws is not merely unlikely, it is evidence
    // the generator is not what it claims to be.
    expect(codes.size).toBe(2000);
  });

  it('API-LINKS-010 a short code is not derivable from ids or from time', () => {
    // The weak form of an untestable property, as the suite Notes specify:
    // codes minted back-to-back for one node must share no prefix, no suffix,
    // and no correlation with either id.
    const nodeId = '11111111-1111-4111-8111-111111111111';
    const shareId = '22222222-2222-4222-8222-222222222222';

    const codes = Array.from({ length: 200 }, () => codec.mintShortCode());

    for (let index = 1; index < codes.length; index += 1) {
      const previous = codes[index - 1] ?? '';
      const current = codes[index] ?? '';

      expect(sharedPrefix(previous, current), `${previous} vs ${current}`).toBeLessThan(4);
      expect(sharedSuffix(previous, current), `${previous} vs ${current}`).toBeLessThan(4);
    }

    // And nothing resembling either id leaks into a code. A derivable code is
    // not a credential — it is an encoding of something the attacker may know.
    const idCharacters = (nodeId + shareId).replace(/-/g, '').toUpperCase();
    for (const code of codes) {
      expect(idCharacters).not.toContain(code.slice(0, 8));
    }
  });

  it('API-LINKS-011 codes decode case-insensitively, mapping I/l to 1 and O to 0', () => {
    // Crockford's rule, and the reason it exists: someone reads a code off a
    // screen and types `l` for `1` or `O` for `0`. Both must reach the same
    // grant rather than a different valid one or a dead end.
    const canonical = 'ABCDEFGH01234567';

    for (const spelling of ['abcdefgh01234567', 'ABCDEFGHO1234567', 'abcdefghOl234567']) {
      expect(codec.hash(spelling), spelling).toBe(codec.hash(canonical));
    }

    // A 43-character token is case-*sensitive* base64url and must not be
    // touched — hence the length test rather than a blanket upper-casing.
    const token = codec.mintToken();
    expect(codec.hash(token.toUpperCase())).not.toBe(codec.hash(token));
  });

  it('API-LINKS-018 a 43-character input is never looked up against the short-code column', () => {
    // Exactly one unique column is probed, always. Two probes would mean one
    // index lookup that is guaranteed to miss on every single request.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(codec.credentialColumn(codec.mintToken())).toBe('tokenHash');
      expect(codec.credentialColumn(codec.mintShortCode())).toBe('shortCodeHash');
    }

    // A malformed guess resolves to the token column rather than to nothing.
    // It must cost the same as an unknown token: a request that returned early
    // would be measurably faster and would tell an attacker their guess had the
    // wrong shape, which is a free filter on the search space.
    for (const malformed of ['', 'short', 'x'.repeat(12), 'y'.repeat(200)]) {
      expect(codec.credentialColumn(malformed), malformed).toBe('tokenHash');
    }
  });
});

function sharedPrefix(left: string, right: string): number {
  let count = 0;
  while (count < left.length && left[count] === right[count]) count += 1;
  return count;
}

function sharedSuffix(left: string, right: string): number {
  let count = 0;
  while (
    count < left.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}
