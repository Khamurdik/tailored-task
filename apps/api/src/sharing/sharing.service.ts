import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Share } from '@prisma/client';
import type { CreateShareRequest } from '@dataroom/shared';

import { ShareCodec, SharesRepository } from '../access';
import { AppError, EventBus } from '../common';
import { NodesService } from '../nodes';
import { UsersService } from '../users';

export interface IssuedShare {
  share: Share;
  /** Plaintext, returned exactly once. Null for a `user` grant — see below. */
  token: string | null;
  shortCode: string | null;
}

export interface ShareWithSource {
  share: Share;
  /** The ancestor the grant hangs off, when it is not on the node itself. */
  inheritedFrom: { id: string; name: string } | null;
}

/**
 * The use-cases around grants. Owns no state — every row belongs to `access`.
 *
 * Nothing here decides authorization either: the controllers run
 * `@RequireAccess('own')` or call `NodeAccessResolver` first. This module's job
 * is what happens *after* the answer is yes.
 */
@Injectable()
export class SharingService implements OnModuleInit {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    private readonly shares: SharesRepository,
    private readonly codec: ShareCodec,
    private readonly nodes: NodesService,
    private readonly users: UsersService,
    private readonly events: EventBus,
  ) {}

  /**
   * The two listeners, registered in one place so the wiring is greppable.
   *
   * Both are `common`'s bus rather than a direct call, and the direction is the
   * reason: `auth` (L2) and `nodes` (L1) both sit *below* this module, so
   * neither may call into it. An event is how a lower layer tells a higher one
   * something happened without depending on it.
   */
  onModuleInit(): void {
    // The counts are swallowed rather than returned: a `Listener` yields
    // nothing, because a bus that collected return values would invite a caller
    // to depend on one, and `emit` is fire-and-forget by design.
    this.events.on('node.deleted', async ({ nodeIds }) => {
      await this.revokeSubtree(nodeIds);
    });
    this.events.on('user.authenticated', async ({ userId, email }) => {
      await this.claimPendingGrants(userId, email);
    });
  }

  /**
   * Issues a grant and mints its credentials.
   *
   * The plaintext is returned here and **nowhere else, ever** — only the SHA-256
   * is stored, so there is no endpoint that could read it back even if someone
   * added one. That is what makes "copy it now" an honest affordance in the
   * share dialog rather than a UI convention.
   */
  async create(input: {
    nodeId: string;
    createdById: string;
    request: CreateShareRequest;
  }): Promise<IssuedShare> {
    const { request } = input;

    /**
     * `editor` is defined in the contract and issued by nothing.
     *
     * The schema admits it on purpose — adding per-user write access later
     * should be a data change rather than a schema change — but admitting it in
     * the *request* would make this route the code path that issues it, and
     * `API-ACCESS-013` asserts no such path exists. Refused explicitly rather
     * than silently downgraded to `viewer`: quietly granting something other
     * than what was asked for is worse than saying no.
     */
    if (request.role !== 'viewer') {
      throw AppError.validationFailed({
        role: 'Only viewer grants can be issued',
      });
    }

    const expiresAt = request.expiresAt === null ? null : new Date(request.expiresAt);

    if (request.kind === 'public_link') {
      const token = this.codec.mintToken();
      const shortCode = request.shortLink ? this.codec.mintShortCode() : null;

      const share = await this.shares.create({
        nodeId: input.nodeId,
        kind: 'public_link',
        role: request.role,
        tokenHash: this.codec.hash(token),
        // Null unless asked for. A grant is only as strong as its weakest
        // credential, and a code takes this share from 256 bits to 80.
        shortCodeHash: shortCode === null ? null : this.codec.hash(shortCode),
        expiresAt,
        createdById: input.createdById,
      });

      return { share, token, shortCode };
    }

    /**
     * A user grant, which may name someone who has no account yet.
     *
     * `principal_user_id` stays null until that person logs in, and
     * `resolveAccess` refuses a grant with a null principal for *everyone* —
     * `API-ACCESS-016` — so a pending grant is inert rather than universal.
     * Binding happens in `claimPendingGrants`, on every login.
     */
    // NFC + trim, the same normalization `SharesRepository` applies when it
    // matches this column later. Case is not touched: `principal_email` is
    // `citext`, so folding it here as well would be a second rule that can
    // disagree with the first. See the `User.email` comment in the schema.
    const email = (request.email ?? '').normalize('NFC').trim();
    if (email === '') throw AppError.validationFailed({ email: 'An email is required' });

    const existing = await this.users.findByEmail(email);

    const share = await this.shares.create({
      nodeId: input.nodeId,
      kind: 'user',
      role: request.role,
      principalEmail: email,
      principalUserId: existing?.id ?? null,
      expiresAt,
      createdById: input.createdById,
    });

    return { share, token: null, shortCode: null };
  }

  /**
   * Every live grant that exposes this node — its own **and** its ancestors'.
   *
   * The inherited half is the point of the endpoint. An owner asking "why is
   * this visible?" gets a wrong answer from a list of direct grants, because the
   * grant that exposed it is usually several levels up, and a list that omits it
   * makes the exposure invisible exactly where it matters.
   */
  async listFor(nodeId: string): Promise<ShareWithSource[]> {
    const ancestry = await this.nodes.ancestryOf(nodeId);
    if (ancestry === null) throw AppError.notFound();

    const scope = [...ancestry.ancestorIds, nodeId];
    const rows = await this.shares.listForNodes(scope);

    // One read for every ancestor name, rather than one per inherited grant.
    const ancestors = await this.nodes.findManyByIds(ancestry.ancestorIds);
    const byId = new Map(ancestors.map((node) => [node.id, node]));

    return rows.map((share) => {
      if (share.nodeId === nodeId) return { share, inheritedFrom: null };
      const source = byId.get(share.nodeId);
      return {
        share,
        inheritedFrom: source === undefined ? null : { id: source.id, name: source.name },
      };
    });
  }

  /** The node a grant hangs off, so a caller can be authorized against it. */
  async nodeOf(shareId: string): Promise<string | null> {
    const share = await this.shares.findById(shareId);
    return share?.nodeId ?? null;
  }

  /** Effective immediately: the resolver's predicate excludes revoked rows. */
  async revoke(shareId: string): Promise<void> {
    await this.shares.revoke(shareId);
  }

  /**
   * Revokes every grant beneath a deleted subtree.
   *
   * Driven by `node.deleted`, which `nodes` emits **after** its transaction
   * commits. Inside it, a listener could act on a delete that then rolls back,
   * and a grant revoked for a node that still exists is not something the
   * listener can undo.
   */
  async revokeSubtree(nodeIds: readonly string[]): Promise<number> {
    const revoked = await this.shares.revokeForNodes(nodeIds);
    if (revoked > 0) {
      this.logger.log(`Revoked ${revoked} grant(s) under ${nodeIds.length} deleted node(s)`);
    }
    return revoked;
  }

  /**
   * Binds grants addressed to an email onto the user who just logged in.
   *
   * **This is the mechanism, not a fallback behind one.** An earlier revision
   * had a `user.created` listener as the fast path with login-time claiming as
   * the guarantee; `user.created` was deleted once it turned out the seeder runs
   * in its own process and an in-process event could never reach this listener,
   * and a hand-written `INSERT` emits nothing either. One trigger, so there is
   * no second path to drift from — see HANDOFF.md §3.13.
   *
   * It runs on *every* login, so it must be idempotent, and it is: the update
   * matches only rows whose `principal_user_id` is still null.
   */
  async claimPendingGrants(userId: string, email: string): Promise<number> {
    const bound = await this.shares.bindPendingToUser(email, userId);
    if (bound > 0) this.logger.log(`Bound ${bound} pending grant(s) for a returning user`);
    return bound;
  }
}
