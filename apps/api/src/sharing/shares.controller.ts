import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';

import { NodeAccessResolver } from '../access';
import { Actor, SessionGuard } from '../auth';
import { AppError, type RequestActor } from '../common';
import { SharingService } from './sharing.service';

/**
 * Revocation, which lives under `/shares/:id` because a grant is addressed by
 * its own id rather than by the node it hangs off.
 *
 * That is precisely why `NodeAccessGuard` is **not** applied here: the guard
 * reads `:id` and would try to resolve a *share* id as a node id, which 404s
 * every request for a reason that has nothing to do with permissions. The
 * authorization is done explicitly instead, through the same resolver the guard
 * uses — one implementation, two callers.
 *
 * No `@RequireAuth()`, for the reason `NodeSharesController` records: it would
 * answer an anonymous caller with 401 where every other denial in the system is
 * 404. `resolve(..., 'own')` already refuses everyone who is not the owner, and
 * it refuses them the same way it refuses a nonexistent share id.
 */
@Controller('shares')
@UseGuards(SessionGuard)
export class SharesController {
  constructor(
    private readonly sharing: SharingService,
    private readonly access: NodeAccessResolver,
  ) {}

  /**
   * 204, and idempotent: revoking an already-revoked grant is a no-op rather
   * than a 404. The caller wants it gone, and it is.
   *
   * **A nonexistent share and a share on somebody else's node are the same
   * 404.** Distinguishing them would confirm that a given share id exists,
   * which is the same enumeration oracle the whole 404-not-403 rule exists to
   * close — and the two branches below are deliberately collapsed into one
   * `throw` for that reason.
   */
  @Delete(':id')
  @HttpCode(204)
  async revoke(@Param('id') id: string, @Actor() actor: RequestActor): Promise<void> {
    const nodeId = await this.sharing.nodeOf(id);
    const access = nodeId === null ? null : await this.access.resolve(actor, nodeId, 'own');
    if (access === null) throw AppError.notFound();

    await this.sharing.revoke(id);
  }
}
