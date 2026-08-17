import { Module } from '@nestjs/common';

import { AccessModule } from '../access';
import { AuthModule } from '../auth';
import { NodesModule } from '../nodes';
import { UsersModule } from '../users';
import { NodeSharesController } from './node-shares.controller';
import { SharesController } from './shares.controller';
import { SharingService } from './sharing.service';

/**
 * L3. The use-cases around grants. Owns no table — every row belongs to
 * `access`, which sits below it so that a share controller can be guarded by a
 * guard that reads shares without the two forming a cycle.
 *
 * Does **not** import `links`, which is its peer in L3 and holds the anonymous
 * half of the same surface. Neither imports the other; both import downward.
 *
 * Does not import `auth` for the login event either — `auth` is L2 and calling
 * upward is what the event bus exists to avoid. `AuthModule` is imported only
 * for `SessionGuard`, which is a request-pipeline component rather than a
 * dependency on the module's behaviour.
 */
@Module({
  imports: [AccessModule, NodesModule, UsersModule, AuthModule],
  controllers: [NodeSharesController, SharesController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
