import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateShareRequestSchema, type CreatedShare, type ShareSummary } from '@dataroom/shared';

import { NodeAccessGuard, RequireAccess } from '../access';
import { Actor, SessionGuard } from '../auth';
import { AppError, type RequestActor } from '../common';
import { toCreatedShare, toShareSummary } from './share.presenter';
import { SharingService } from './sharing.service';

/**
 * The owner's view of sharing. **Every route here requires `own`, with no
 * exceptions**, and that sentence is the reason `links` is a separate module
 * rather than one more method on this controller.
 *
 * A file holding both an owner-only route and an anonymous one is exactly where
 * a missing guard hides: the reviewer's eye reads "this is the owner API" and
 * skips the one method that isn't. Keeping them apart also lets a suite assert
 * the property with no carve-out — see `API-SHARING-020`.
 *
 * ## Why there is no `@RequireAuth()` here
 *
 * It was the first thing written and it produced the wrong status. `SessionGuard`
 * throws **401** for a caller holding a share token, and `API-SHARING-007`
 * requires **404** — a viewer who tries to re-share must not learn anything at
 * all, and 401 says "this route exists and your kind of credential is wrong".
 *
 * It is also unnecessary. `own` comes from `nodes.owner_id` and no grant can
 * confer it, so `@RequireAccess('own')` already excludes every anonymous and
 * share-scoped caller — and it excludes them through the single 404 that
 * `API-ACCESS-011` requires every denial to be. `API-SHARING-020` is what keeps
 * that true for routes added later.
 */
@Controller('nodes')
@UseGuards(SessionGuard, NodeAccessGuard)
export class NodeSharesController {
  constructor(private readonly sharing: SharingService) {}

  /**
   * Grants on this node **and** the ones it inherits, visibly distinguished.
   *
   * Guarded by `own` rather than `read` on purpose: who has access to something
   * is the owner's business, and a viewer being able to enumerate the other
   * recipients of a document is a disclosure in its own right.
   */
  @Get(':id/shares')
  @RequireAccess('own')
  async list(@Param('id') id: string): Promise<{ items: ShareSummary[]; nextCursor: null }> {
    const entries = await this.sharing.listFor(id);
    return { items: entries.map(toShareSummary), nextCursor: null };
  }

  @Post(':id/shares')
  @RequireAccess('own')
  async create(
    @Param('id') id: string,
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<CreatedShare> {
    const parsed = CreateShareRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validationFailed({
        kind: 'A share needs a kind, and a user grant needs an email',
      });
    }

    /**
     * Unreachable, and a 404 rather than a 401 anyway.
     *
     * `@RequireAccess('own')` has already established a user actor — `owner` is
     * only ever resolved by matching `nodes.owner_id` against a `userId`. This
     * narrows the type for the compiler; the status is chosen so that even the
     * impossible branch cannot become the one response that answers differently.
     */
    if (actor === null || !('userId' in actor)) throw AppError.notFound();

    const issued = await this.sharing.create({
      nodeId: id,
      createdById: actor.userId,
      request: parsed.data,
    });

    return toCreatedShare(issued);
  }
}
