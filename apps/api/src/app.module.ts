import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AccessModule, NODE_LOOKUP } from './access';
import { AuthModule } from './auth';
import { CommonModule } from './common';
import { NodesModule, NodesRepository } from './nodes';
import { StorageModule } from './storage';
import { UsersModule } from './users';

/**
 * The one inverted dependency in the system, bound in the one place allowed to
 * know both sides.
 *
 * ## Why this is a `@Global()` module and not two lines in `AppModule`
 *
 * The architecture document says the binding is
 * `providers: [{ provide: NODE_LOOKUP, useExisting: NodesRepository }]` in
 * `AppModule`, and that does not work. **Nest resolves a provider's dependencies
 * within its own module's injector**, not from its parent — so `NodeAccessGuard`,
 * declared in `AccessModule`, cannot see a token provided one level up. It fails
 * at boot with "Nest can't resolve dependencies of the NodeAccessGuard … make
 * sure that Symbol(NODE_LOOKUP) is available in the AccessModule module".
 *
 * The two obvious fixes are both worse:
 *
 *   - provide it inside `AccessModule` — which needs `NodesRepository`, so
 *     `access` would import `nodes` and the cycle the port exists to break is
 *     back;
 *   - have `NodesModule` provide it — which needs the token, so `nodes` (L1)
 *     would import `access` (L2), upward and forbidden.
 *
 * A global binding declared *here* keeps both source-level rules intact:
 * `access` never imports `nodes`, `nodes` never imports `access`, and the
 * composition root stays the only file that names both. Global also matters
 * practically — guards are resolved from the module declaring the controller, so
 * every L3 module using `@UseGuards(NodeAccessGuard)` would otherwise need the
 * binding repeated.
 */
@Global()
@Module({
  imports: [NodesModule],
  // `useExisting`, not `useClass`: the same singleton the tree operations use,
  // rather than a second instance with its own client.
  providers: [{ provide: NODE_LOOKUP, useExisting: NodesRepository }],
  exports: [NODE_LOOKUP],
})
class NodeLookupBindingModule {}

/**
 * The composition root.
 *
 * Modules are added bottom-up, in the README's build order. There is no
 * `forwardRef` anywhere in this codebase — `API-ACCESS-018` asserts it — and if
 * one starts to look necessary, a boundary is wrong.
 */
@Module({
  imports: [
    /**
     * Rate limiting, global by default.
     *
     * Global rather than per-route because the routes that need it most are the
     * ones nobody remembers to annotate — and an unthrottled login is a
     * credential-stuffing surface. `/health` opts out explicitly
     * (`@SkipThrottle()`): App Runner polls it about every ten seconds, and
     * throttling the health check is how an instance gets marked unhealthy by
     * its own rate limiter.
     */
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    CommonModule,
    StorageModule,
    UsersModule,
    NodesModule,
    NodeLookupBindingModule,
    AccessModule,
    AuthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
