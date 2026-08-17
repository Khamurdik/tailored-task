import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { AppError, EventBus, MAX_DEPTH, PrismaService } from '../common';
import { isSelfOrDescendant, parseAncestors } from './node-path';
import { NodeNamingService, isUniqueViolation } from './node-naming.service';
import { NodesRepository } from './nodes.repository';
import type { Ancestry, Node, SubtreeStats } from './node.types';

/**
 * The tree's use-cases.
 *
 * Authorization is decided **before** this module is called — `access`'s guard
 * runs in the pipeline ahead of the controller — so nothing here checks who is
 * asking. Mixing the two would give the owner path and the share path two
 * different permission code paths, which is the thing the whole authn/authz
 * split exists to prevent.
 */
@Injectable()
export class NodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesRepository,
    private readonly naming: NodeNamingService,
    private readonly events: EventBus,
  ) {}

  async findById(id: string): Promise<Node | null> {
    return this.nodes.findById(id);
  }

  async ancestryOf(id: string): Promise<Ancestry | null> {
    return this.nodes.findAncestry(id);
  }

  /** Ancestors as nodes, root first, self last — what breadcrumbs render from. */
  async breadcrumbs(id: string): Promise<Node[]> {
    const node = await this.nodes.findById(id);
    if (node === null) return [];

    const path = await this.nodes.pathOf(id);
    const ancestorIds = path === null ? [] : parseAncestors(path);
    if (ancestorIds.length === 0) return [node];

    // One query for the whole chain, then ordered in memory. A query per crumb
    // is the version that looks fine on a two-level tree and is eight round
    // trips at depth eight.
    const ancestors = await Promise.all(ancestorIds.map((each) => this.nodes.findById(each)));
    return [...ancestors.filter((each): each is Node => each !== null), node];
  }

  async createRoom(ownerId: string, name: string): Promise<Node> {
    return this.insertWithUniqueName(name, null, ownerId, (unique, tx) =>
      this.nodes.createRoom({ id: randomUUID(), ownerId, name: unique }, tx),
    );
  }

  async createFolder(parentId: string, name: string): Promise<Node> {
    const parent = await this.requireContainer(parentId);
    this.assertDepth(parent.node.depth + 1, 0);

    return this.insertWithUniqueName(
      name,
      parent.node.id,
      parent.node.ownerId,
      (unique, tx) =>
        this.nodes.createChild(
          { id: randomUUID(), type: 'folder', parent: parent.withPath, name: unique },
          tx,
        ),
    );
  }

  /**
   * Inserts, resolving a name collision by retrying with a suffix.
   *
   * ## Each attempt is its own transaction, and that is the whole point
   *
   * The obvious version wraps one transaction around the retry loop. It cannot
   * work: **a constraint violation aborts a Postgres transaction**, so every
   * statement after it fails with "current transaction is aborted" — including
   * the read that would find a free name. The first implementation did exactly
   * that, and ten concurrent uploads of one name produced nine
   * `PrismaClientUnknownRequestError`s rather than nine renames.
   *
   * The alternative is a `SAVEPOINT` per attempt, which Prisma does not expose.
   * A fresh transaction per attempt is simpler and has the same effect.
   *
   * The loop is also why this is optimistic rather than a pre-check: reading the
   * sibling names and then inserting is a race, and the unique index is the only
   * thing that can actually arbitrate. Capped at ten — beyond that something
   * other than contention is wrong, and looping forever turns a bug into an
   * outage.
   */
  private async insertWithUniqueName(
    requested: string,
    parentId: string | null,
    ownerId: string,
    insert: (name: string, tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<Node>,
  ): Promise<Node> {
    const base = this.naming.prepare(requested);
    let candidate = base;
    const attempted: string[] = [];

    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return await this.prisma.$transaction((tx) => insert(candidate, tx));
      } catch (cause) {
        if (!isUniqueViolation(cause)) throw cause;

        attempted.push(candidate);
        candidate = await this.naming.nextFreeName(base, parentId, ownerId, attempted);
      }
    }

    throw AppError.conflict(`Could not find a free name for "${base}" after 10 attempts`);
  }

  /**
   * A deliberate rename, which fails loudly on a collision.
   *
   * Unlike an upload, the user typed this name — so a silent suffix would be
   * the wrong kindness. They get a 409 carrying a suggestion and choose.
   */
  async rename(id: string, name: string): Promise<Node> {
    const node = await this.requireLive(id);
    const prepared = this.naming.prepare(name);
    if (prepared === node.name) return node;

    try {
      return await this.nodes.rename(id, prepared);
    } catch (cause) {
      if (!isUniqueViolation(cause)) throw cause;

      throw AppError.nameConflict(
        await this.naming.suggestFor(prepared, node.parentId, node.ownerId, id),
      );
    }
  }

  /**
   * Moves a node, with the two rejections that matter.
   *
   * The lock is taken before the paths are read, not after. Two concurrent moves
   * that each read a path and then rewrite it can interleave into a tree whose
   * paths point at parents the nodes no longer have — and the corruption is
   * silent until something walks the tree.
   */
  async move(id: string, newParentId: string): Promise<Node> {
    return this.prisma.$transaction(async (tx) => {
      if (id === newParentId) throw AppError.cyclicMove();

      const fromPath = await this.nodes.lockPath(id, tx);
      if (fromPath === null) throw AppError.notFound();

      const node = await this.nodes.findById(id, tx);
      if (node === null || node.deletedAt !== null) throw AppError.notFound();
      if (node.type === 'room') {
        throw AppError.validationFailed({ node: 'A room has no parent and cannot be moved' });
      }

      const destination = await this.requireContainer(newParentId, tx);
      if (node.parentId === destination.node.id) return node;

      // The move that looks legal from the parent's side and silently detaches
      // a subtree. Checked against paths rather than by walking, because the
      // path already encodes the answer.
      if (isSelfOrDescendant(fromPath, destination.withPath.path)) throw AppError.cyclicMove();

      const subtree = await this.nodes.listSubtree(fromPath, tx);
      const height = subtree.reduce((tallest, each) => Math.max(tallest, each.depth - node.depth), 0);
      this.assertDepth(destination.node.depth + 1, height);

      const toPath = `${destination.withPath.path}/${node.id}`;
      const depthDelta = destination.node.depth + 1 - node.depth;

      try {
        await this.nodes.moveSubtree(
          {
            nodeId: node.id,
            fromPath,
            toPath,
            newParentId: destination.node.id,
            newRootId: destination.node.rootId,
            depthDelta,
          },
          tx,
        );
      } catch (cause) {
        if (!isUniqueViolation(cause)) throw cause;

        // A sibling in the destination already has this name. A move is
        // deliberate, so this is a 409 with a suggestion rather than a silent
        // rename — same reasoning as `rename`.
        throw AppError.nameConflict(
          await this.naming.suggestFor(node.name, destination.node.id, node.ownerId, node.id),
        );
      }

      const moved = await this.nodes.findById(id, tx);
      if (moved === null) throw AppError.notFound();
      return moved;
    });
  }

  /**
   * Soft-deletes a node and its whole subtree, in one transaction.
   *
   * The event carries every affected id so `sharing` can revoke grants beneath
   * it. Known limitation, recorded rather than hidden: the list is unbounded, so
   * deleting a large room puts every descendant id in one payload.
   */
  async softDelete(id: string): Promise<{ deletedIds: string[] }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const path = await this.nodes.lockPath(id, tx);
      if (path === null) throw AppError.notFound();

      const node = await this.nodes.findById(id, tx);
      if (node === null || node.deletedAt !== null) throw AppError.notFound();

      const deletedIds = await this.nodes.softDeleteSubtree(path, tx);
      return { rootId: node.rootId, deletedIds };
    });

    // Emitted after the transaction commits. Inside it, a listener could act on
    // a delete that then rolls back — and revoking a grant for a node that
    // still exists is not something the listener can undo.
    this.events.emit('node.deleted', { rootId: result.rootId, nodeIds: result.deletedIds });

    return { deletedIds: result.deletedIds };
  }

  /** Live aggregate, computed. What a delete confirmation is allowed to show. */
  async statsFor(id: string): Promise<SubtreeStats> {
    const path = await this.nodes.pathOf(id);
    if (path === null) throw AppError.notFound();
    return this.nodes.subtreeStats(path);
  }

  /** The escape hatch. Regenerates derived ancestry from `parent_id`. */
  async rebuildSubtree(rootId: string): Promise<number> {
    return this.prisma.$transaction((tx) => this.nodes.rebuildSubtree(rootId, tx));
  }

  private assertDepth(targetDepth: number, subtreeHeight: number): void {
    if (targetDepth + subtreeHeight > MAX_DEPTH) throw AppError.depthLimit(MAX_DEPTH);
  }

  private async requireLive(id: string): Promise<Node> {
    const node = await this.nodes.findById(id);
    if (node === null || node.deletedAt !== null) throw AppError.notFound();
    return node;
  }

  /**
   * A container that can take children, with its path attached.
   *
   * Returns 404 for a missing node, a deleted one, and a *file* alike. A file is
   * not a folder, and answering "that is a file" would confirm the id exists.
   */
  private async requireContainer(
    id: string,
    tx?: Parameters<NodesRepository['findById']>[1],
  ): Promise<{ node: Node; withPath: Node & { path: string } }> {
    const node = await this.nodes.findById(id, tx);
    if (node === null || node.deletedAt !== null || node.type === 'file') throw AppError.notFound();

    const path = await this.nodes.pathOf(id, tx);
    if (path === null) throw AppError.notFound();

    return { node, withPath: { ...node, path } };
  }
}
