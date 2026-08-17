import { Module } from '@nestjs/common';

import { NodeAccessGuard } from './node-access.guard';
import { NodeAccessResolver } from './node-access.resolver';
import { ShareCodec } from './share-codec';
import { SharesRepository } from './shares.repository';

/**
 * L2. Grants, the resolver, and the guard.
 *
 * `NODE_LOOKUP` is **not** provided here — this module declares the port and
 * never implements it. The binding happens once in `AppModule`, which is the one
 * place allowed to know that `NodesRepository` satisfies it.
 */
@Module({
  providers: [SharesRepository, ShareCodec, NodeAccessResolver, NodeAccessGuard],
  exports: [SharesRepository, ShareCodec, NodeAccessResolver, NodeAccessGuard],
})
export class AccessModule {}
