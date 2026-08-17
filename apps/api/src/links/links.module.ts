import { Module } from '@nestjs/common';

import { AccessModule } from '../access';
import { LinksController } from './links.controller';

/**
 * L3. The anonymous edge, and nothing else.
 *
 * Imports `access` and **nothing else** — not `sharing`, which is its peer in
 * L3 rather than below it, and not `nodes`. The absence of `nodes` is
 * deliberate: if this module could read the tree, the anonymous path would have
 * a second way to learn about a node that did not pass through the access
 * resolver. See `links/TODO.md` §What resolve returns.
 */
@Module({
  imports: [AccessModule],
  controllers: [LinksController],
})
export class LinksModule {}
