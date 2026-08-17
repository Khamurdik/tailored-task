import { Module } from '@nestjs/common';

import { CommonModule } from './common';
import { NodesModule } from './nodes';
import { StorageModule } from './storage';
import { UsersModule } from './users';

/**
 * The composition root.
 *
 * This is also where the one inverted dependency in the system gets bound —
 * `{ provide: NODE_LOOKUP, useExisting: NodesRepository }` — once `nodes` and
 * `access` exist. There is no `forwardRef` anywhere in this codebase, and if
 * one starts to look necessary, a boundary is wrong.
 *
 * Modules are added bottom-up, in the order in README's build order.
 */
@Module({
  imports: [CommonModule, StorageModule, UsersModule, NodesModule],
})
export class AppModule {}
