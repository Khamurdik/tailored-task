import {
  BreadcrumbSchema,
  ChildrenPageSchema,
  NodeDetailSchema,
  NodeSummarySchema,
  type Breadcrumb,
  type ChildrenPage,
  type NodeDetail,
  type NodeSummary,
} from '@dataroom/shared';

import { AppError } from '../common';
import type { Node } from './node.types';

/**
 * The boundary between a `Node` row and the wire.
 *
 * ## Why this is in `nodes` rather than in a controller module
 *
 * It started in `tree`, beside the only controller that used it, and moved the
 * moment `files` needed it too: `/uploads/:id/complete` answers with a
 * `NodeDetail`, and `files` importing `tree` would be an L3 module importing its
 * own layer — the exact shape the `sharing`/`links` split exists to avoid.
 *
 * `nodes` is where it belongs on reflection rather than merely where it is
 * convenient. This module already owns the `Node` contract; the projection of
 * that contract onto the wire is part of publishing it, and `packages/shared` is
 * a dependency-free schema package rather than a layer, so naming it here adds
 * no edge to the graph. The alternative was two copies of the same mapping,
 * which is how `subtreeFiles` ends up null in one response and 0 in another.
 *
 * Every function here ends in a `parse`, not a cast. A cast asserts the shape is
 * right; a parse finds out. The difference matters most for the fields nothing
 * else checks — a `Date` that should have been an ISO string, a `bigint` that
 * would serialise as `"0n"` — because those reach the client as a plausible
 * value rather than an error and are diagnosed weeks later from a screenshot.
 *
 * A mismatch is a 500 (`AppError` with `INTERNAL`), never a coerced response.
 * This service breaking its own contract is a bug here, not a condition a client
 * can act on.
 */

/**
 * `subtreeFiles` / `subtreeBytes` are null on a file, where they would only
 * restate `sizeBytes` — that is the contract's rule, not a convenience.
 *
 * On a folder or a room they are the **stored rollups**, which nothing
 * maintains yet: the columns default to 0 and `files` lands their maintenance
 * with `API-FILES-016`. Reporting 0 is honest while no file can exist, and
 * becomes a lie the moment one can — which is why the rollup work is a checkbox
 * in `files/TODO.md` and not a nice-to-have.
 */
export function toSummary(node: Node): NodeSummary {
  return parse(
    NodeSummarySchema,
    {
      id: node.id,
      type: node.type,
      name: node.name,
      state: node.state,
      sizeBytes: node.sizeBytes,
      contentType: node.contentType,
      subtreeFiles: node.type === 'file' ? null : node.subtreeFiles,
      subtreeBytes: node.type === 'file' ? null : node.subtreeBytes,
      updatedAt: node.updatedAt.toISOString(),
    },
    'NodeSummary',
  );
}

export function toBreadcrumb(node: Node): Breadcrumb {
  return parse(BreadcrumbSchema, { id: node.id, name: node.name, type: node.type }, 'Breadcrumb');
}

/**
 * Note what a detail does **not** carry: no `path`, and no ancestor id list.
 *
 * How `nodes` stores ancestry is that module's private business, and a
 * breadcrumb trail is the only part of it a client has any use for. Adding
 * either field here would publish the storage strategy to every consumer and
 * undo the decision `nodes/TODO.md` §Storage was written to protect.
 */
export function toDetail(node: Node, breadcrumbs: readonly Node[]): NodeDetail {
  return parse(
    NodeDetailSchema,
    {
      ...toSummary(node),
      rootId: node.rootId,
      parentId: node.parentId,
      depth: node.depth,
      breadcrumbs: breadcrumbs.map(toBreadcrumb),
      createdAt: node.createdAt.toISOString(),
    },
    'NodeDetail',
  );
}

export function toChildrenPage(page: {
  items: readonly Node[];
  nextCursor: string | null;
  breadcrumbs: readonly Node[];
}): ChildrenPage {
  return parse(
    ChildrenPageSchema,
    {
      items: page.items.map(toSummary),
      nextCursor: page.nextCursor,
      breadcrumbs: page.breadcrumbs.map(toBreadcrumb),
    },
    'ChildrenPage',
  );
}

function parse<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) {
    // Deliberately not `validationFailed`: a 400 would blame the caller for a
    // response this service got wrong.
    throw new AppError('INTERNAL', `${what} failed its own contract`, 500);
  }
  return result.data;
}
