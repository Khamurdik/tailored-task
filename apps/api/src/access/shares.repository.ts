import { Injectable } from '@nestjs/common';
import { Prisma, type Share } from '@prisma/client';

import { PrismaService } from '../common';
import { ShareCodec } from './share-codec';
import type { Grant } from './resolve-access';

/**
 * The only code that reads or writes the `shares` table.
 *
 * `API-ACCESS-014` is a static check over the source tree asserting exactly
 * that — it defends the boundary the module exists to create.
 */
@Injectable()
export class SharesRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly codec: ShareCodec,
  ) {}

  /**
   * Every **live** grant on a set of node ids, in **one query regardless of
   * depth**.
   *
   * ## Why expiry and revocation are in the predicate
   *
   * Filtering them in JS would work and would cost the design its best property.
   * `resolveAccess` is a pure function; the moment it has to compare
   * `expires_at` to now, it needs a clock, and every test of the permission
   * matrix needs to stub one. Excluding them here means a grant that reaches the
   * resolver is live *by construction* — so `API-ACCESS-007` asserts this query
   * rather than the resolver, and needs no clock stub at all.
   *
   * One query rather than one per ancestor is what the materialized path buys:
   * the ancestor ids are already known before any grant is fetched, so depth
   * costs nothing. `API-ACCESS-012` asserts the round-trip count.
   */
  async liveGrantsFor(nodeIds: readonly string[], now = new Date()): Promise<Grant[]> {
    if (nodeIds.length === 0) return [];

    const rows = await this.prisma.share.findMany({
      where: {
        nodeId: { in: [...nodeIds] },
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, nodeId: true, role: true, principalUserId: true },
    });

    return rows;
  }

  async findById(id: string): Promise<Share | null> {
    return this.prisma.share.findUnique({ where: { id } });
  }

  /**
   * Resolves a **plaintext** credential to a live grant.
   *
   * Takes the plaintext rather than a hash so that hashing and the choice of
   * column are one decision in one place. Every caller — the access resolver and
   * the anonymous `links` route — reaches the same rule, which matters because
   * the rule is security-relevant on both counts.
   *
   * `ShareCodec.credentialColumn` picks exactly one unique, indexed column, so
   * this is a single lookup rather than a scan or a double probe — and the query
   * an attacker guessing tokens reaches is the cheapest one available, on
   * purpose, because the throttle rather than the query cost is what bounds
   * them.
   *
   * Liveness is in the predicate, which is what makes unknown, revoked and
   * expired indistinguishable to the caller: all three return null, and the
   * caller has no way to tell them apart even if it wanted to.
   */
  async findLiveByCredential(credential: string, now = new Date()): Promise<Share | null> {
    const column = this.codec.credentialColumn(credential);
    const hash = this.codec.hash(credential);

    return this.prisma.share.findFirst({
      where: {
        [column]: hash,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
  }

  async listForNodes(nodeIds: readonly string[]): Promise<Share[]> {
    return this.prisma.share.findMany({
      where: { nodeId: { in: [...nodeIds] }, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: Prisma.ShareUncheckedCreateInput): Promise<Share> {
    return this.prisma.share.create({ data });
  }

  async revoke(id: string, at = new Date()): Promise<void> {
    // `updateMany`, so revoking an already-revoked grant is a no-op rather than a
    // P2025. Revocation is idempotent by nature: the caller wants it gone.
    await this.prisma.share.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  /**
   * Revokes every grant on a set of nodes. Called when a subtree is deleted.
   *
   * Takes ids rather than a path prefix, which is the one place this module
   * would rather have the prefix — a large room puts every descendant id in one
   * `IN` list. Recorded as a known limitation rather than solved, because fixing
   * it means `access` learning what a path is.
   */
  async revokeForNodes(nodeIds: readonly string[], at = new Date()): Promise<number> {
    if (nodeIds.length === 0) return 0;

    const result = await this.prisma.share.updateMany({
      where: { nodeId: { in: [...nodeIds] }, revokedAt: null },
      data: { revokedAt: at },
    });
    return result.count;
  }

  /** Pending grants addressed to an email that has no account yet. */
  async findPendingForEmail(email: string): Promise<Share[]> {
    return this.prisma.share.findMany({
      where: {
        principalEmail: email.normalize('NFC').trim(),
        principalUserId: null,
        revokedAt: null,
      },
    });
  }

  /** Binds pending grants to a user. Idempotent — it runs on every login. */
  async bindPendingToUser(email: string, userId: string): Promise<number> {
    const result = await this.prisma.share.updateMany({
      where: {
        principalEmail: email.normalize('NFC').trim(),
        principalUserId: null,
        revokedAt: null,
      },
      data: { principalUserId: userId },
    });
    return result.count;
  }
}
