import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateFolderRequestSchema,
  CreateRoomRequestSchema,
  MoveNodeRequestSchema,
  PageQuerySchema,
  RenameNodeRequestSchema,
  type ChildrenPage,
  type NodeDetail,
  type NodeStats,
} from '@dataroom/shared';

import { NodeAccessGuard, NodeAccessResolver, RequireAccess } from '../access';
import { Actor, RequireAuth, SessionGuard } from '../auth';
import { AppError, type AccessContext, type RequestActor } from '../common';
import { NodesService, toChildrenPage, toDetail, type Node } from '../nodes';

/**
 * The tree over HTTP.
 *
 * **Guard order is load-bearing.** `SessionGuard` runs first and attaches
 * `req.actor`; `NodeAccessGuard` reads it. Nest executes guards in the order
 * they are listed, so swapping these two makes every node-scoped route see an
 * anonymous caller and 404 — which reads as a permission bug rather than a
 * wiring one.
 *
 * Nothing in this file decides authorization. Every route either carries
 * `@RequireAccess`, or calls `NodeAccessResolver` — the same method the guard
 * calls — for a node its route could not name. See `TODO.md` §The two routes a
 * guard cannot protect.
 *
 * Bodies are parsed with `safeParse` rather than relying on the global
 * `ZodValidationPipe`, matching `AuthController`: the pipe is a `nestjs-zod`
 * front end that only fires for `createZodDto` classes, and this codebase
 * declares its schemas in `packages/shared` instead.
 */
@Controller('nodes')
@UseGuards(SessionGuard, NodeAccessGuard)
export class NodesController {
  constructor(
    private readonly nodes: NodesService,
    private readonly access: NodeAccessResolver,
  ) {}

  /**
   * The caller's rooms.
   *
   * `@RequireAuth()` rather than `@RequireAccess('read')`, and that is not an
   * oversight: a room has no parent, so there is no node for the guard to
   * authorize against. Ownership is the only available scope and the repository
   * applies it in the query — which also means a share visitor gets an empty
   * list here rather than a 404, because they have no rooms rather than because
   * they were denied.
   */
  @Get()
  @RequireAuth()
  async listRooms(@Actor() actor: RequestActor): Promise<ChildrenPage> {
    const rooms = await this.nodes.listRooms(this.requireUserId(actor));
    return toChildrenPage({ items: rooms, nextCursor: null, breadcrumbs: [] });
  }

  @Post()
  @RequireAuth()
  async createRoom(@Actor() actor: RequestActor, @Body() body: unknown): Promise<NodeDetail> {
    const parsed = CreateRoomRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.validationFailed({ name: 'A room needs a name' });

    const room = await this.nodes.createRoom(this.requireUserId(actor), parsed.data.name);
    return toDetail(room, [room]);
  }

  /**
   * Create a folder. **The parent is in the body, so the guard cannot see it.**
   *
   * `assertWritable` is what closes that — the same resolution the guard would
   * have performed, called explicitly because the route has no `:id` to hang it
   * on. Without it this route was writable by any authenticated caller, in
   * anybody's room.
   *
   * Declared before `:id` routes so the literal segment is not swallowed by a
   * parameter.
   */
  @Post('folders')
  async createFolder(@Actor() actor: RequestActor, @Body() body: unknown): Promise<NodeDetail> {
    const parsed = CreateFolderRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validationFailed({ name: 'A folder needs a parent and a name' });
    }

    await this.assertWritable(actor, parsed.data.parentId);

    const folder = await this.nodes.createFolder(parsed.data.parentId, parsed.data.name);
    return this.detailOf(folder, null);
  }

  @Get(':id/children')
  @RequireAccess('read')
  async listChildren(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: Request,
  ): Promise<ChildrenPage> {
    const parsed = PageQuerySchema.safeParse(coercePageQuery(query));
    if (!parsed.success) throw AppError.validationFailed({ query: 'Invalid page request' });

    const page = await this.nodes.listChildren({
      parentId: id,
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit,
      breadcrumbsStopAt: this.accessOf(request).grantNodeId,
    });

    return toChildrenPage(page);
  }

  @Get(':id/stats')
  @RequireAccess('read')
  async stats(@Param('id') id: string): Promise<NodeStats> {
    return this.nodes.statsFor(id);
  }

  @Patch(':id/name')
  @RequireAccess('write')
  async rename(@Param('id') id: string, @Body() body: unknown, @Req() request: Request): Promise<NodeDetail> {
    const parsed = RenameNodeRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.validationFailed({ name: 'A name is required' });

    const renamed = await this.nodes.rename(id, parsed.data.name);
    return this.detailOf(renamed, this.accessOf(request).grantNodeId);
  }

  /**
   * Move a node. **The destination is in the body, so the guard cannot see it.**
   *
   * `@RequireAccess('write')` authorizes the node being *moved* and says nothing
   * about where it lands, so without the second check a node could be moved into
   * a folder the caller has no write access to — a way to put a document into
   * someone else's room using only your own permissions.
   */
  @Patch(':id/parent')
  @RequireAccess('write')
  async move(
    @Param('id') id: string,
    @Body() body: unknown,
    @Actor() actor: RequestActor,
    @Req() request: Request,
  ): Promise<NodeDetail> {
    const parsed = MoveNodeRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.validationFailed({ parentId: 'A destination is required' });

    await this.assertWritable(actor, parsed.data.parentId);

    const moved = await this.nodes.move(id, parsed.data.parentId);
    return this.detailOf(moved, this.accessOf(request).grantNodeId);
  }

  @Get(':id')
  @RequireAccess('read')
  async detail(@Param('id') id: string, @Req() request: Request): Promise<NodeDetail> {
    const node = await this.nodes.findById(id);
    // The guard already resolved this id, so a null here means the row vanished
    // between the guard and this line. Same 404 either way.
    if (node === null) throw AppError.notFound();

    return this.detailOf(node, this.accessOf(request).grantNodeId);
  }

  /**
   * 204, and the body is the deleted id list only in the log — not in the
   * response. A caller that needs to know what went with it asks `/stats`
   * *before* deleting, which is what the confirmation dialog does anyway.
   */
  @Delete(':id')
  @RequireAccess('write')
  @HttpCode(204)
  async remove(@Param('id') id: string): Promise<void> {
    await this.nodes.softDelete(id);
  }

  // ---------------------------------------------------------------------------

  /**
   * The check a guard could not perform, delegated to the guard's own resolver.
   *
   * Throws the identical `AppError.notFound()` the guard throws, so a denial
   * from here is byte-identical to a denial from there — `API-ACCESS-011`
   * requires that, and it only holds while every denial is constructed the one
   * way.
   */
  private async assertWritable(actor: RequestActor, nodeId: string): Promise<void> {
    const resolved = await this.access.resolve(actor, nodeId, 'write');
    if (resolved === null) throw AppError.notFound();
  }

  /** A detail with its breadcrumb trail, truncated at a share's root if there is one. */
  private async detailOf(node: Node, stopAt: string | null): Promise<NodeDetail> {
    return toDetail(node, await this.nodes.breadcrumbs(node.id, stopAt));
  }

  /**
   * What `NodeAccessGuard` attached. Present on every `@RequireAccess` route by
   * construction — the guard sets it before the handler runs — so its absence
   * is a wiring mistake rather than a request the client got wrong.
   */
  private accessOf(request: Request): AccessContext {
    const access = request.access;
    if (access === undefined) {
      throw new AppError('INTERNAL', 'Route reached without an access context', 500);
    }
    return access;
  }

  private requireUserId(actor: RequestActor): string {
    // `@RequireAuth()` has already guaranteed a user actor; this narrows the
    // type rather than re-checking a decision the guard made.
    if (actor === null || !('userId' in actor)) throw AppError.unauthenticated();
    return actor.userId;
  }
}

/**
 * A query string is strings, all the way down.
 *
 * `PageQuerySchema` types `limit` as an integer because that is what it *is* —
 * and Express hands over `'50'`. The adaptation belongs here rather than in
 * `packages/shared`: the schema is shared with a client that builds the query
 * from real numbers, and making it coerce would mean the client's own
 * validation silently accepted `limit: "banana"` too.
 *
 * `Number()` rather than `parseInt()`: `parseInt('50abc')` is 50, which would
 * quietly accept a malformed parameter, while `Number('50abc')` is `NaN` and
 * the schema rejects it. `undefined` is left alone so the schema's default
 * applies rather than being overwritten with `NaN`.
 */
function coercePageQuery(query: unknown): unknown {
  if (typeof query !== 'object' || query === null) return {};
  const raw = query as Record<string, unknown>;

  return {
    ...raw,
    ...(raw['limit'] === undefined ? {} : { limit: Number(raw['limit']) }),
  };
}
