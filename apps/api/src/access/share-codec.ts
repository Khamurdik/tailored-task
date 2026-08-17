import { createHash, randomBytes, randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * Mints and hashes the credentials that reach a grant.
 *
 * It lives in `access` rather than in `links` because `sharing` issues
 * credentials and `links` reads them, and if either owned the format the other
 * would be importing sideways within L3. Both import downward instead. The
 * format is *specified* in `links/TODO.md`; this is where it is implemented,
 * next to the columns it fills.
 */

/**
 * Crockford base32: no `I`, `L`, `O` or `U`.
 *
 * `I`/`L`/`O` are excluded because a code read off a screen and retyped must not
 * land on a *different valid code* by transcription. `U` is excluded to keep
 * accidental words out of codes people will paste into email.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SHORT_CODE_LENGTH = 16;

@Injectable()
export class ShareCodec {
  /** 32 CSPRNG bytes, base64url — 43 characters, 256 bits. Always minted. */
  mintToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * 16 Crockford characters — 80 bits. **Opt-in per share.**
   *
   * A grant is only as strong as its weakest credential, so minting one takes
   * that share from 256 bits to 80. 80 is still unguessable by any practical
   * means, but it is not a trade to make on every share silently.
   *
   * `randomInt` rather than `randomBytes(16)` mapped with `%`: 256 is not a
   * multiple of 32... it is, in fact, so modulo would be uniform here — but only
   * by luck of the alphabet length, and an alphabet change would silently bias
   * the output. `randomInt` is uniform by contract.
   */
  mintShortCode(): string {
    let code = '';
    for (let index = 0; index < SHORT_CODE_LENGTH; index += 1) {
      code += CROCKFORD[randomInt(CROCKFORD.length)];
    }
    return code;
  }

  /**
   * SHA-256, hex. What is stored, for both credential kinds.
   *
   * Not argon2, and the difference matters. A password is low-entropy and
   * human-chosen, so it needs a slow hash to survive an offline attack on the
   * stored value. These are 256 and 80 bits of CSPRNG output — there is nothing
   * to brute-force — and this hash is on the path of every request a share
   * visitor makes, so a deliberately slow one would be a self-inflicted rate
   * limit on legitimate reads.
   */
  hash(credential: string): string {
    return createHash('sha256').update(this.canonicalize(credential)).digest('hex');
  }

  /**
   * Normalises a presented credential before hashing.
   *
   * Crockford decoding is case-insensitive and maps the excluded letters onto
   * the digits they resemble, so a code retyped as `l` or `O` still resolves.
   * A 43-character token is case-*sensitive* base64url and must not be touched —
   * hence the length test rather than a blanket upper-casing.
   */
  canonicalize(credential: string): string {
    const trimmed = credential.trim();
    if (trimmed.length !== SHORT_CODE_LENGTH) return trimmed;

    return trimmed
      .toUpperCase()
      .replaceAll('I', '1')
      .replaceAll('L', '1')
      .replaceAll('O', '0');
  }

  /**
   * Whether an input could be a short code at all.
   *
   * Used to skip a pointless second index probe, **never to reject a request**.
   * Rejecting a malformed credential with a validation error tells an attacker
   * their guess had the wrong shape, which is a free filter on the search space —
   * see `API-LINKS-005`.
   */
  looksLikeShortCode(credential: string): boolean {
    return credential.trim().length === SHORT_CODE_LENGTH;
  }
}

export { CROCKFORD, SHORT_CODE_LENGTH };
