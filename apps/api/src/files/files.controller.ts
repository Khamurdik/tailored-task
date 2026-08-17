import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  InitUploadRequestSchema,
  MAX_FILE_SIZE,
  type ContentUrlResponse,
  type InitUploadResponse,
  type NodeDetail,
} from '@dataroom/shared';

import { NodeAccessGuard, NodeAccessResolver, RequireAccess } from '../access';
import { Actor, SessionGuard } from '../auth';
import { AppError, type AccessContext, type RequestActor } from '../common';
import { NodesService, toDetail } from '../nodes';
import { FilesService } from './files.service';

/**
 * The upload lifecycle over HTTP.
 *
 * `/uploads/:id` is a **node** id throughout — the pending row created at init —
 * so `NodeAccessGuard` protects `/complete` and `/abort` directly. `/init` is the
 * exception and names its parent in the body, which the guard cannot see; it
 * takes the same explicit `NodeAccessResolver` call `POST /nodes/folders` does.
 */
@Controller('uploads')
@UseGuards(SessionGuard, NodeAccessGuard)
export class UploadsController {
  constructor(
    private readonly files: FilesService,
    private readonly nodes: NodesService,
    private readonly access: NodeAccessResolver,
  ) {}

  /**
   * Reserve the name, create the `pending` row, hand back a signed PUT.
   *
   * A size over the cap is a **413**, not a generic validation error: the client
   * has a specific thing to tell the user and a specific number to show them,
   * and the upload queue distinguishes "too big" from "malformed" in its retry
   * logic. `MAX_FILE_SIZE` rides along in `details` so that number comes from
   * the server rather than from a constant the bundle might have gone stale on.
   */
  @Post('init')
  async init(@Actor() actor: RequestActor, @Body() body: unknown): Promise<InitUploadResponse> {
    const parsed = InitUploadRequestSchema.safeParse(body);
    if (!parsed.success) {
      const tooBig = parsed.error.issues.some((issue) => issue.path[0] === 'sizeBytes');
      throw tooBig
        ? AppError.fileTooLarge(MAX_FILE_SIZE)
        : AppError.validationFailed({
            upload: 'An upload needs a parent, a name, a size and a content type',
          });
    }

    // The parent is in the body, so the guard never fired. Same resolver, same
    // 404 — see `tree/TODO.md` §The two routes a guard cannot protect.
    const writable = await this.access.resolve(actor, parsed.data.parentId, 'write');
    if (writable === null) throw AppError.notFound();

    const { node, uploadUrl } = await this.files.init(parsed.data);

    return {
      nodeId: node.id,
      uploadUrl,
      // The resolved name, which may differ from the requested one. The client
      // surfaces it as "uploaded as report (2).pdf" rather than silently
      // renaming the user's file.
      finalName: node.name,
    };
  }

  @Post(':id/complete')
  @RequireAccess('write')
  async complete(@Param('id') id: string, @Req() request: Request): Promise<NodeDetail> {
    const node = await this.files.complete(id);
    return toDetail(node, await this.nodes.breadcrumbs(node.id, accessOf(request).grantNodeId));
  }

  @Post(':id/abort')
  @RequireAccess('write')
  @HttpCode(204)
  async abort(@Param('id') id: string): Promise<void> {
    await this.files.abort(id);
  }
}

/**
 * The download URL, which lives under `/nodes` because it is a fact about a
 * node rather than about an upload — and because `public-view` fetches it with
 * a share token, on the same route shape as everything else it reads.
 */
@Controller('nodes')
@UseGuards(SessionGuard, NodeAccessGuard)
export class FileContentController {
  constructor(private readonly files: FilesService) {}

  /**
   * `read`, not `write`. A viewer holding a share token is exactly who this is
   * for — and it is the one route in the system that hands out a credential
   * (a presigned URL) to someone who was never authenticated, which is why the
   * TTL is short and why `API-FILES-013` checks a stranger gets 404.
   */
  @Get(':id/content-url')
  @RequireAccess('read')
  async contentUrl(@Param('id') id: string): Promise<ContentUrlResponse> {
    const issued = await this.files.contentUrl(id);
    return { url: issued.url, expiresAt: issued.expiresAt.toISOString() };
  }
}

function accessOf(request: Request): AccessContext {
  const access = request.access;
  if (access === undefined) {
    throw new AppError('INTERNAL', 'Route reached without an access context', 500);
  }
  return access;
}
