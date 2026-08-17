import { Module } from '@nestjs/common';

import { NodeNamingService } from './node-naming.service';
import { NodesRepository } from './nodes.repository';
import { NodesService } from './nodes.service';

/**
 * L1. The tree. Depends on `common` and nothing else — not `storage` (a file row
 * does not know what a bucket is), not `access` (authorization is decided before
 * this module is called), not `auth`.
 */
@Module({
  providers: [NodesRepository, NodeNamingService, NodesService],
  exports: [NodesService, NodesRepository],
})
export class NodesModule {}
