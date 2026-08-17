import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';

import { PrismaService } from '../common';

export interface IssuedRefreshToken {
  /** The plaintext. Returned to the client once and never stored. */
  token: string;
  familyId: string;
  expiresAt: Date;
}

/** What a presented token turned out to be. */
export type RefreshOutcome =
  | { kind: 'valid'; row: RefreshToken }
  /** Known, but already rotated or revoked — a replay. */
  | { kind: 'reused'; row: RefreshToken }
  /** Not a token this system ever issued, or long since purged. */
  | { kind: 'unknown' };

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * SHA-256, hex. Only the digest is stored.
   *
   * Not argon2, for the same reason as share credentials: this is 32 bytes of
   * CSPRNG output, so there is nothing to brute-force, and the hash is computed
   * on every refresh.
   */
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async issue(userId: string, ttlMs: number, familyId?: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const family = familyId ?? randomUUID();
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hash(token), familyId: family, expiresAt },
    });

    return { token, familyId: family, expiresAt };
  }

  /**
   * Classifies a presented token into one of three outcomes.
   *
   * The three-way answer is the whole design. A two-way "valid or not" cannot
   * tell a **replay** from a stranger's guess, and those call for different
   * responses: a guess is simply refused, while a replay means the token was
   * copied and every token descended from that login has to die. Keeping the
   * revoked rows around — rather than deleting on rotation — is what makes the
   * distinction observable at all.
   */
  async classify(token: string, now = new Date()): Promise<RefreshOutcome> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(token) },
    });

    if (row === null) return { kind: 'unknown' };
    if (row.revokedAt !== null) return { kind: 'reused', row };
    // An expired token is not a replay — nobody did anything wrong, the session
    // simply ended. Treated as unknown so it does not kill a family.
    if (row.expiresAt <= now) return { kind: 'unknown' };
    return { kind: 'valid', row };
  }

  /** Marks one token as rotated away. */
  async revoke(id: string, at = new Date()): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  /**
   * Kills every live token in a family.
   *
   * This is what logout does, and what a detected replay does. Note the limit of
   * what it can achieve: **a JWT is not revocable**, so an access token issued
   * from this family keeps working until it expires — up to 24 hours at
   * `JWT_ACCESS_TTL=1d`. That is written down in `auth/TODO.md` rather than
   * papered over; making the window real needs a per-request revocation check,
   * not a shorter TTL.
   */
  async revokeFamily(familyId: string, at = new Date()): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
    return result.count;
  }

  /** For `purge-expired-tokens`. */
  async purge(before = new Date()): Promise<number> {
    const result = await this.prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { not: null } }] },
    });
    return result.count;
  }
}
