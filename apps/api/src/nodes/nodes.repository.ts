import { Injectable } from '@nestjs/common';
import { Prisma, type Node as PrismaNode } from '@prisma/client';

import { PrismaService } from '../common';
import {
  buildPath,
  escapeLikePrefix,
  parseAncestors,
  rebase,
  subtreePrefix,
} from './node-path';
import type { Ancestry, Node, NodeSnapshot, SubtreeStats } from './node.types';

/**
 * The sort position of one row, in the listing's exact order.
 *
 * The tuple *is* the cursor payload — `common`'s `CursorService` signs these
 * three fields and nothing else. Keeping the shape here rather than importing
 * the cursor type keeps the repository ignorant of how a position is encoded.
 */
export interface ChildPosition {
  type: string;
  name: string;
  id: string;
}

/**
 * Explicit columns, aliased to the names `toDomain` reads.
 *
 * `SELECT *` is wrong in a raw query here and silently so: `$queryRaw` returns
 * the **database's** column names, so `root_id` never becomes `rootId` the way
 * it does through the model API, and every mapped field arrives as `undefined`.
 * `listSubtree` had exactly that bug and got away with it because its only
 * caller reads `depth`, which is spelled the same either way.
 *
 * The two enum casts are deliberate: `::text` guarantees a string rather than
 * whatever the driver decides a custom enum OID decodes to.
 *
 * **Every `ORDER BY` over this list must qualify its columns** — `"nodes"."type"`,
 * not `"type"`. Postgres resolves a bare `ORDER BY` name against the *output*
 * columns first, so with `"type"::text AS "type"` in scope it sorts by the text
 * label and `'file'` lands before `'folder'` alphabetically — the exact reverse
 * of the enum order the whole folders-before-files rule depends on. A qualified
 * reference can only mean the input column.
 */
const NODE_COLUMNS = Prisma.sql`
  "id",
  "type"::text AS "type",
  "state"::text AS "state",
  "root_id" AS "rootId",
  "parent_id" AS "parentId",
  "owner_id" AS "ownerId",
  "name",
  "depth",
  "size_bytes" AS "sizeBytes",
  "content_type" AS "contentType",
  "subtree_files" AS "subtreeFiles",
  "subtree_bytes" AS "subtreeBytes",
  "deleted_at" AS "deletedAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"
`;

/**
 * The only code that reads or writes the `nodes` table, and the only code that
 * knows a `path` column exists.
 *
 * Every subtree operation is a method here rather than a predicate a caller
 * writes. That is the boundary that makes the storage strategy replaceable: a
 * caller who writes `WHERE path LIKE …` has hard-coded the strategy at a site
 * the strategy cannot see.
 */
@Injectable()
export class NodesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<Node | null> {
    const row = await this.client(tx).node.findUnique({ where: { id } });
    return row === null ? null : toDomain(row);
  }

  /**
   * Ancestry, from the path, in the query that already reads the node.
   *
   * `ancestorsDeleted` is computed here rather than by the caller because
   * `access`'s resolver is a pure function: given only its own `deletedAt` it
   * has no way to see a deleted ancestor, and the "deny if any ancestor is
   * deleted" invariant would be unenforceable as written.
   */
  async findAncestry(id: string, tx?: Prisma.TransactionClient): Promise<Ancestry | null> {
    const client = this.client(tx);
    const row = await client.node.findUnique({ where: { id }, select: { path: true } });
    if (row === null) return null;

    const ancestorIds = parseAncestors(row.path);
    if (ancestorIds.length === 0) return { ancestorIds, ancestorsDeleted: false };

    const deleted = await client.node.count({
      where: { id: { in: [...ancestorIds] }, deletedAt: { not: null } },
    });

    return { ancestorIds, ancestorsDeleted: deleted > 0 };
  }

  /** Satisfies `access`'s `NodeLookupPort`. Bound in `AppModule`, never imported by it. */
  async findSnapshot(id: string): Promise<NodeSnapshot | null> {
    const row = await this.prisma.node.findUnique({
      where: { id },
      select: { id: true, rootId: true, ownerId: true, path: true, deletedAt: true },
    });
    if (row === null) return null;

    const ancestorIds = parseAncestors(row.path);
    const ancestorsDeleted =
      ancestorIds.length > 0 &&
      (await this.prisma.node.count({
        where: { id: { in: ancestorIds }, deletedAt: { not: null } },
      })) > 0;

    return {
      id: row.id,
      rootId: row.rootId,
      ownerId: row.ownerId,
      ancestorIds,
      deletedAt: row.deletedAt,
      ancestorsDeleted,
    };
  }

  /**
   * One page of live children, in the listing's order: **folders before files,
   * then by name, then by id.**
   *
   * ## Why this is raw SQL
   *
   * `ORDER BY "name" COLLATE "C"` is not expressible through Prisma's `orderBy`,
   * and the collation is not a preference — index `nodes_children_listing` is
   * declared `("parent_id", "type", "name" COLLATE "C", "id") WHERE deleted_at
   * IS NULL`, and a keyset cursor that compares under a *different* collation
   * than the index orders by silently skips or duplicates rows at page
   * boundaries. It is invisible with ASCII names, which is exactly how it ships.
   * This query matches that index term for term.
   *
   * Folders-before-files is free: `node_type` is declared
   * `('room', 'folder', 'file')`, and a Postgres enum sorts in declaration
   * order. That ordering is load-bearing rather than cosmetic, which is why the
   * enum is not alphabetical.
   *
   * The row-constructor comparison is what makes this a keyset rather than an
   * offset — the planner turns `(a, b, c) > (x, y, z)` into an index seek, so
   * page 400 costs what page 1 costs and a row inserted mid-paging cannot shift
   * the window.
   *
   * Returns up to `limit + 1` rows; the caller uses the extra one to decide
   * whether there is a next page without a second `count(*)`.
   */
  async listChildren(
    input: { parentId: string; after: ChildPosition | null; limit: number },
    tx?: Prisma.TransactionClient,
  ): Promise<Node[]> {
    const keyset =
      input.after === null
        ? Prisma.empty
        : Prisma.sql`AND ("type", "name" COLLATE "C", "id")
                   > (${input.after.type}::"node_type", ${input.after.name} COLLATE "C", ${input.after.id}::uuid)`;

    const rows = await this.client(tx).$queryRaw<PrismaNode[]>(Prisma.sql`
      SELECT ${NODE_COLUMNS}
        FROM "nodes"
       WHERE "parent_id" = ${input.parentId}::uuid
         AND "deleted_at" IS NULL
         ${keyset}
       ORDER BY "nodes"."type", "nodes"."name" COLLATE "C", "nodes"."id"
       LIMIT ${input.limit + 1}::int
    `);

    return rows.map(toDomain);
  }

  /**
   * The rooms an owner has, in the same order children are listed in.
   *
   * A room's parent is NULL, so it cannot come out of `listChildren` — Postgres
   * treats NULLs as distinct and `parent_id = NULL` matches nothing. Rooms are
   * scoped by owner instead, which is also the only scoping that makes sense:
   * a room has no parent to be authorized against, so this is the one listing
   * `NodeAccessGuard` cannot guard and ownership is checked directly.
   */
  async listRooms(ownerId: string, tx?: Prisma.TransactionClient): Promise<Node[]> {
    const rows = await this.client(tx).$queryRaw<PrismaNode[]>(Prisma.sql`
      SELECT ${NODE_COLUMNS}
        FROM "nodes"
       WHERE "owner_id" = ${ownerId}::uuid
         AND "parent_id" IS NULL
         AND "deleted_at" IS NULL
       ORDER BY "nodes"."type", "nodes"."name" COLLATE "C", "nodes"."id"
    `);

    return rows.map(toDomain);
  }

  /**
   * Several nodes by id, in **one** query.
   *
   * Exists so breadcrumbs are one round trip rather than one per crumb. The
   * caller reorders; the database has no opinion about ancestor order and
   * asking it to impose one would mean sending the chain twice.
   */
  async findManyByIds(ids: readonly string[], tx?: Prisma.TransactionClient): Promise<Node[]> {
    if (ids.length === 0) return [];
    const rows = await this.client(tx).node.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toDomain);
  }

  async liveSiblingNames(
    parentId: string | null,
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string[]> {
    const rows = await this.client(tx).node.findMany({
      // A room's siblings are the owner's other rooms — `parentId: null` alone
      // would be every room in the system, which is how one owner's naming
      // would start constraining another's.
      where:
        parentId === null
          ? { parentId: null, ownerId, deletedAt: null }
          : { parentId, deletedAt: null },
      select: { name: true },
    });
    return rows.map((row) => row.name);
  }

  async createRoom(input: {
    id: string;
    ownerId: string;
    name: string;
  }, tx?: Prisma.TransactionClient): Promise<Node> {
    // A room is its own root and its own path. Both are database-enforced
    // (`nodes_root_self_reference`, `nodes_room_depth_zero`).
    const row = await this.client(tx).node.create({
      data: {
        id: input.id,
        type: 'room',
        rootId: input.id,
        parentId: null,
        ownerId: input.ownerId,
        name: input.name,
        path: buildPath(null, input.id),
        depth: 0,
      },
    });
    return toDomain(row);
  }

  async createChild(input: {
    id: string;
    type: 'folder' | 'file';
    parent: Pick<Node, 'id' | 'rootId' | 'ownerId' | 'depth'> & { path: string };
    name: string;
    state?: 'pending' | 'active';
  }, tx?: Prisma.TransactionClient): Promise<Node> {
    const row = await this.client(tx).node.create({
      data: {
        id: input.id,
        type: input.type,
        state: input.state ?? 'active',
        rootId: input.parent.rootId,
        parentId: input.parent.id,
        ownerId: input.parent.ownerId,
        name: input.name,
        path: buildPath(input.parent.path, input.id),
        depth: input.parent.depth + 1,
      },
    });
    return toDomain(row);
  }

  async rename(id: string, name: string, tx?: Prisma.TransactionClient): Promise<Node> {
    return toDomain(await this.client(tx).node.update({ where: { id }, data: { name } }));
  }

  /** The path of one node, and a row lock on it. See `moveSubtree`. */
  async lockPath(id: string, tx: Prisma.TransactionClient): Promise<string | null> {
    // `FOR UPDATE` before reading the path, not after. Two concurrent moves that
    // both read a path and then rewrite it produce a tree where one subtree's
    // paths point at a parent it no longer has.
    const rows = await tx.$queryRaw<{ path: string }[]>`
      SELECT "path" FROM "nodes" WHERE "id" = ${id}::uuid FOR UPDATE
    `;
    return rows[0]?.path ?? null;
  }

  /**
   * Moves a subtree in one statement.
   *
   * The whole subtree is rewritten by prefix, which is the operation the
   * materialized path was chosen for. `depth` shifts by a constant delta,
   * because a move changes every descendant's depth by the same amount.
   */
  async moveSubtree(
    input: {
      nodeId: string;
      fromPath: string;
      toPath: string;
      newParentId: string;
      newRootId: string;
      depthDelta: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const prefix = `${escapeLikePrefix(input.fromPath)}%`;

    /**
     * Front-anchored rewrite, not `replace(path, old, new)`: SQL `replace` is
     * global, so a path containing the old prefix twice would have both
     * occurrences rewritten. It cannot happen in a well-formed tree — an id
     * appears once — and the anchored version is correct for a malformed one too.
     *
     * The `::int` casts are load-bearing. Prisma binds a JS number as `bigint`,
     * and there is no `substring(text, bigint)` in Postgres — the statement fails
     * with `42883 function does not exist`, which reads as a typo rather than a
     * type mismatch. This is the line the property test caught: every move had
     * been rejected before reaching it, so the UPDATE had never once run.
     */
    const affected = await tx.$executeRaw`
      UPDATE "nodes"
         SET "path"  = ${input.toPath} || substring("path" FROM ${input.fromPath.length + 1}::int),
             "depth" = "depth" + ${input.depthDelta}::int,
             "root_id" = ${input.newRootId}::uuid,
             "updated_at" = now()
       WHERE "path" = ${input.fromPath} OR "path" LIKE ${prefix} ESCAPE '\\'
    `;

    // The moved node's own parent changes; its descendants keep theirs.
    await tx.node.update({
      where: { id: input.nodeId },
      data: { parentId: input.newParentId },
    });

    return affected;
  }

  /**
   * Soft-deletes a node and everything under it, returning the affected ids.
   *
   * One statement for the whole subtree. The ids come back because `sharing`
   * listens for them to revoke grants — a known limitation, since the list is
   * unbounded for a large room.
   */
  async softDeleteSubtree(path: string, tx: Prisma.TransactionClient): Promise<string[]> {
    const prefix = `${escapeLikePrefix(path)}%`;

    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "nodes"
         SET "deleted_at" = now(), "updated_at" = now()
       WHERE ("path" = ${path} OR "path" LIKE ${prefix} ESCAPE '\\')
         AND "deleted_at" IS NULL
      RETURNING "id"
    `;

    return rows.map((row) => row.id);
  }

  /**
   * Live subtree aggregate, computed rather than read from the rollups.
   *
   * This is what a delete confirmation shows, and the one number that must not
   * come from a denormalized counter: telling someone they are about to delete
   * 14 files when a drifted counter says 14 and the truth is 400 is worse than
   * showing nothing.
   */
  async subtreeStats(path: string, tx?: Prisma.TransactionClient): Promise<SubtreeStats> {
    const prefix = `${escapeLikePrefix(subtreePrefix(path))}%`;

    const rows = await this.client(tx).$queryRaw<
      { type: string; count: bigint; bytes: bigint | null }[]
    >`
      SELECT "type", count(*) AS "count", sum("size_bytes") AS "bytes"
        FROM "nodes"
       WHERE "path" LIKE ${prefix} ESCAPE '\\'
         AND "deleted_at" IS NULL
         AND "state" = 'active'
       GROUP BY "type"
    `;

    let files = 0;
    let folders = 0;
    let bytes = 0;
    for (const row of rows) {
      if (row.type === 'file') {
        files = Number(row.count);
        bytes = Number(row.bytes ?? 0n);
      } else if (row.type === 'folder') {
        folders = Number(row.count);
      }
    }
    return { files, folders, bytes };
  }

  /**
   * Regenerates every path in a subtree from `parent_id`.
   *
   * The escape hatch, and it is only writable because `parent_id` is the source
   * of truth. If a migration or a bug corrupts derived state, this rebuilds it
   * from the thing that was never derived.
   */
  async rebuildSubtree(rootId: string, tx: Prisma.TransactionClient): Promise<number> {
    const rows = await tx.$queryRaw<{ affected: bigint }[]>`
      WITH RECURSIVE rebuilt AS (
        SELECT "id", '/' || "id"::text AS "path", 0 AS "depth"
          FROM "nodes"
         WHERE "id" = ${rootId}::uuid
        UNION ALL
        SELECT child."id", parent."path" || '/' || child."id"::text, parent."depth" + 1
          FROM "nodes" child
          JOIN rebuilt parent ON child."parent_id" = parent."id"
      )
      UPDATE "nodes" AS n
         SET "path" = rebuilt."path", "depth" = rebuilt."depth"
        FROM rebuilt
       WHERE n."id" = rebuilt."id"
         AND (n."path" <> rebuilt."path" OR n."depth" <> rebuilt."depth")
      RETURNING 1 AS "affected"
    `;
    return rows.length;
  }

  /**
   * Descendants of a node, live only, for the property test and for stats checks.
   *
   * The column list is explicit for the reason given on `NODE_COLUMNS`: this
   * was `SELECT *`, and every `@map`ped field — `rootId`, `parentId`,
   * `sizeBytes` — came back `undefined`. It went unnoticed because the only
   * caller reads `depth`, which is spelled the same in both worlds. Fixed here
   * rather than left for whoever reads the second field.
   */
  async listSubtree(path: string, tx?: Prisma.TransactionClient): Promise<Node[]> {
    const prefix = `${escapeLikePrefix(subtreePrefix(path))}%`;
    const rows = await this.client(tx).$queryRaw<PrismaNode[]>(Prisma.sql`
      SELECT ${NODE_COLUMNS} FROM "nodes" WHERE "path" LIKE ${prefix} ESCAPE '\\'
    `);
    return rows.map(toDomain);
  }

  /** The path of a node, for callers inside this module only. */
  async pathOf(id: string, tx?: Prisma.TransactionClient): Promise<string | null> {
    const row = await this.client(tx).node.findUnique({ where: { id }, select: { path: true } });
    return row?.path ?? null;
  }

  /** Used by `rebase` at the service layer without exposing the format. */
  rebasePath(path: string, fromPath: string, toPath: string): string {
    return rebase(path, fromPath, toPath);
  }

  /**
   * The transaction client, or the pooled one.
   *
   * Typed as `TransactionClient` rather than a union: it is `PrismaClient`
   * minus the methods that cannot be called inside a transaction, so every
   * model access is available and the union that a caller would otherwise have
   * to narrow does not arise.
   */
  private client(tx?: Prisma.TransactionClient): Prisma.TransactionClient {
    return tx ?? this.prisma;
  }
}

function toDomain(row: PrismaNode): Node {
  return {
    id: row.id,
    type: row.type,
    state: row.state,
    rootId: row.rootId,
    parentId: row.parentId,
    ownerId: row.ownerId,
    name: row.name,
    depth: row.depth,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    subtreeFiles: row.subtreeFiles,
    // BigInt on the wire would serialise as a string and surprise every caller;
    // 50 MiB files mean a room would need ~170 million of them to overflow a
    // JS safe integer.
    subtreeBytes: Number(row.subtreeBytes),
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
