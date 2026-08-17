import { Controller, Get, Headers, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ResolveShareResponseSchema, type ResolveShareResponse } from '@dataroom/shared';
import type { Response } from 'express';

import { NodeAccessResolver, SharesRepository } from '../access';
import { AppError } from '../common';

/**
 * The only anonymous, unguarded, attacker-reachable route in the API.
 *
 * Note what is **not** here: `SessionGuard`, `NodeAccessGuard`, `@RequireAuth`.
 * A visitor holding a link was never authenticated and never will be — the
 * credential is presented on every request and no session is ever issued
 * (`API-LINKS-017`). The authorization that does happen goes through
 * `NodeAccessResolver`, the same path an owner's request takes.
 */
@Controller('shares')
export class LinksController {
  constructor(
    private readonly shares: SharesRepository,
    private readonly access: NodeAccessResolver,
  ) {}

  /**
   * `X-Share-Token: <token | code>` → `{ rootNodeId, role, expiresAt }`, or a
   * uniform 404.
   *
   * ## Every failure is the same failure
   *
   * Unknown, malformed, revoked, expired, and pointing at a deleted node all
   * return the identical status, body and headers. There is one `throw` site
   * below and it constructs `AppError.notFound()`, which is the only way
   * `API-LINKS-004` can hold — three separate tests each asserting "404" pass
   * happily while the bodies differ by one field, and one field is all an oracle
   * needs.
   *
   * **The credential is never validated for shape.** No length check, no
   * alphabet check, no zod schema on the header. Rejecting a malformed guess
   * with `VALIDATION_FAILED` would tell an attacker their guess had the wrong
   * *form*, which filters the search space for free and costs them nothing
   * against the throttle (`API-LINKS-005`).
   *
   * ## Why the throttle is so much tighter than the global one
   *
   * This endpoint is the guessing surface for every share in the system. No
   * legitimate visitor resolves more than a handful of links a minute — they
   * open one link and read it — so a bound that would be absurd on a listing
   * route is generous here.
   */
  @Get('resolve')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async resolve(
    @Headers('x-share-token') presented: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ResolveShareResponse> {
    /**
     * Set before anything can throw, so a 404 carries them too.
     *
     * `no-referrer` matters even though the credential travels in a header
     * here: the **page** that called this endpoint has the code in its own URL
     * (`/s/:code`), and any third-party request from that page would otherwise
     * leak it in `Referer`. `no-store` keeps it out of a shared cache. Both must
     * be on the failure response as well, or the header set becomes one more
     * way to tell the two outcomes apart.
     */
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');

    // No early return on an absent header. An empty credential takes the same
    // path as a wrong one — one hash, one indexed lookup, one miss.
    const credential = presented ?? '';

    const share = await this.shares.findLiveByCredential(credential);
    if (share === null) throw AppError.notFound();

    /**
     * The grant exists and is live; the node it points at may not be.
     *
     * Routed through `NodeAccessResolver` rather than checked here so that a
     * deleted target, a deleted *ancestor*, and a revoked grant are decided by
     * one rule — `API-LINKS-006`. Anything less than `read` is the same 404.
     */
    const access = await this.access.resolve({ shareToken: credential }, share.nodeId, 'read');
    if (access === null) throw AppError.notFound();

    /**
     * Deliberately no node name, type, or child count — even though
     * `public-view` renders all three and will therefore make a second request
     * for `GET /nodes/:rootNodeId` with the same header.
     *
     * That second request is the point. Inlining a summary here would give the
     * anonymous path a second way to learn about a node, one that did not go
     * through `NodeAccessGuard`. Every fact a visitor learns about the tree
     * should come through the same guard an owner's request does, and the cost
     * of that rule is one extra round trip on one page load.
     */
    const parsed = ResolveShareResponseSchema.safeParse({
      rootNodeId: share.nodeId,
      role: share.role,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    });

    if (!parsed.success) {
      throw new AppError('INTERNAL', 'ResolveShareResponse failed its own contract', 500);
    }
    return parsed.data;
  }
}
