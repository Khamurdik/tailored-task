import { Module } from '@nestjs/common';

import { AccessModule } from '../access';
import { AuthModule } from '../auth';
import { NodesModule } from '../nodes';
import { NodesController } from './nodes.controller';

/**
 * L3. The tree's HTTP surface, and nothing else.
 *
 * It exists because `nodes` is L1 and a controller needs `@RequireAccess`, which
 * is L2 — see `TODO.md` §Why this module exists at all. `nodes` stays ignorant
 * of authorization, which is the property that lets `access` resolve a
 * permission without importing the tree.
 *
 * Exports nothing. A controller-only module that exports something has stopped
 * being a controller-only module.
 */
@Module({
  imports: [NodesModule, AccessModule, AuthModule],
  controllers: [NodesController],
})
export class TreeModule {}
