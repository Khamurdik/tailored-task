import { MAX_DEPTH } from '@dataroom/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PrismaService } from '@api/common';
import { NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';
import { makeUser } from '@support/factories';

/**
 * The tree, checked against `parent_id`.
 *
 * **Every assertion here recomputes the truth by walking `parent_id` in the
 * test.** That is the whole design of this file. Reading back the derived
 * ancestry and comparing it to itself would pass for any consistent-but-wrong
 * implementation; walking the source of truth means the code has to get the
 * derivation right, not merely get it the same way twice.
 *
 * It is also what made this writable before the storage strategy was chosen.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let ownerId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  ownerId = (await makeUser(prisma)).id;
});

/** Every row, with the derived columns the invariants are about. */
async function allRows(): Promise<
  { id: string; parentId: string | null; path: string; depth: number; deletedAt: Date | null; rootId: string }[]
> {
  return prisma.$queryRaw`
    SELECT "id", "parent_id" AS "parentId", "path", "depth", "deleted_at" AS "deletedAt",
           "root_id" AS "rootId"
      FROM "nodes"
  `;
}

/** The ancestor chain, walked from `parent_id` alone. Root first, excluding self. */
function walkAncestors(
  rows: Map<string, { parentId: string | null }>,
  id: string,
): string[] {
  const chain: string[] = [];
  let current = rows.get(id)?.parentId ?? null;

  for (let hops = 0; current !== null && hops <= MAX_DEPTH + 2; hops += 1) {
    chain.unshift(current);
    current = rows.get(current)?.parentId ?? null;
  }
  return chain;
}

/**
 * Asserts the four invariants, from `parent_id`, over the entire table.
 *
 * Run after every operation in the property test rather than at the end: a
 * failure then names the operation that broke it instead of leaving 200 to
 * bisect by hand.
 */
async function assertTreeIsConsistent(): Promise<void> {
  const rows = await allRows();
  const byId = new Map(rows.map((row) => [row.id, row]));

  for (const row of rows) {
    const ancestors = walkAncestors(byId, row.id);

    // 1. The derived path equals the ancestor chain ending in self.
    expect(row.path, `path of ${row.id}`).toBe(`/${[...ancestors, row.id].join('/')}`);

    // 2. depth equals the ancestor count.
    expect(row.depth, `depth of ${row.id}`).toBe(ancestors.length);

    // 3. No cycles — a node is never its own ancestor.
    expect(ancestors, `cycle through ${row.id}`).not.toContain(row.id);

    // 4. No live node under a deleted parent.
    if (row.deletedAt === null) {
      for (const ancestorId of ancestors) {
        expect(byId.get(ancestorId)?.deletedAt, `${row.id} is live under deleted ${ancestorId}`).toBeNull();
      }
    }

    // The root is the top of the chain, which is what makes room-scoped
    // queries safe after a move between rooms.
    expect(row.rootId, `rootId of ${row.id}`).toBe(ancestors[0] ?? row.id);
  }
}

describe('the tree', () => {
  /**
   * All four property declarations, named in one title because they are one
   * model — which is what `TODO.md` §Notes specifies: 200 operations applied to
   * the real tree, with the four invariants asserted after every step.
   *
   * Four ids rather than four `it` blocks because the run is the expensive part
   * and each property already fails with its own message
   * (`assertTreeIsConsistent` labels every expectation), which is the reason the
   * declarations were split in the first place. The coverage gate reads every id
   * in a title, so the trace stays one-to-one.
   *
   * These titles carried the wrong ids until 2026-08-18: this test was
   * `API-NODES-001` alone and the seven below it were numbered `002`–`008`,
   * which are declarations about moves, cascades and stats. Every property was
   * being asserted and every id resolved to a real declaration, so the gate saw
   * nothing wrong — it matches ids, not descriptions. What was broken was the
   * id → behaviour trace the whole registry rests on.
   */
  it('API-NODES-001 API-NODES-002 API-NODES-003 API-NODES-004 200 random operations leave every path, depth, cycle and deleted-ancestor invariant consistent', async () => {
    // Not fast-check: the interesting failures here come from *sequences* of
    // operations against real rows, and a shrinker cannot replay a database.
    // A seeded PRNG gives a reproducible sequence and the assertion after every
    // step names the operation that broke, which is what shrinking would buy.
    let seed = 0x2f6e2b1;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const pick = <T>(items: T[]): T | undefined =>
      items.length === 0 ? undefined : items[Math.floor(random() * items.length)];

    const rooms: string[] = [(await nodes.createRoom(ownerId, 'Room A')).id];
    const containers: string[] = [...rooms];
    const live = new Set(containers);

    let created = 0;
    let moved = 0;
    let renamed = 0;
    let deleted = 0;

    for (let step = 0; step < 200; step += 1) {
      const roll = random();

      if (roll < 0.55) {
        // create
        const parent = pick([...live].filter((id) => containers.includes(id)));
        if (parent === undefined) continue;
        const parentNode = await nodes.findById(parent);
        if (parentNode === null || parentNode.depth + 1 > MAX_DEPTH - 1) continue;

        const folder = await nodes.createFolder(parent, `Ström ${step}`);
        containers.push(folder.id);
        live.add(folder.id);
        created += 1;
      } else if (roll < 0.75) {
        // move
        const source = pick([...live].filter((id) => !rooms.includes(id)));
        const destination = pick([...live].filter((id) => containers.includes(id)));
        if (source === undefined || destination === undefined || source === destination) continue;

        try {
          await nodes.move(source, destination);
          moved += 1;
        } catch (cause) {
          // A cyclic or too-deep move is a *correct* rejection, and the
          // generator produces them on purpose — rejecting them is behaviour
          // under test, not an obstacle to it.
          const code = (cause as { code?: string }).code;
          expect(
            ['CYCLIC_MOVE', 'DEPTH_LIMIT', 'NAME_CONFLICT', 'NOT_FOUND'],
            `step ${step}: ${String((cause as { message?: string }).message).slice(0, 400)}`,
          ).toContain(code);
        }
      } else if (roll < 0.9) {
        // rename
        const target = pick([...live]);
        if (target === undefined) continue;
        await nodes.rename(target, `Renamed ${step} — café`);
        renamed += 1;
      } else {
        // delete
        const target = pick([...live].filter((id) => !rooms.includes(id)));
        if (target === undefined) continue;

        const { deletedIds } = await nodes.softDelete(target);
        for (const id of deletedIds) live.delete(id);
        deleted += 1;
      }

      await assertTreeIsConsistent();
    }

    // The generator has to actually generate. A run where nothing moved or
    // nothing was deleted still passes every assertion and proves nothing about
    // those paths.
    expect(created, 'creates').toBeGreaterThan(20);
    expect(moved, 'moves').toBeGreaterThan(5);
    expect(renamed, 'renames').toBeGreaterThan(5);
    expect(deleted, 'deletes').toBeGreaterThan(2);
  }, 120_000);

  it('API-NODES-005 a move into its own descendant is rejected', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const parent = await nodes.createFolder(room.id, 'Parent');
    const child = await nodes.createFolder(parent.id, 'Child');
    const grandchild = await nodes.createFolder(child.id, 'Grandchild');

    for (const destination of [child.id, grandchild.id]) {
      await expect(nodes.move(parent.id, destination)).rejects.toMatchObject({
        code: 'CYCLIC_MOVE',
      });
    }

    // The tree is untouched by the rejection — a partial move is worse than no
    // move, because it detaches a subtree silently.
    await assertTreeIsConsistent();
  });

  it('API-NODES-006 a move to itself is rejected', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const folder = await nodes.createFolder(room.id, 'Folder');

    await expect(nodes.move(folder.id, folder.id)).rejects.toMatchObject({ code: 'CYCLIC_MOVE' });
  });

  it('API-NODES-007 the depth cap is rejected with DEPTH_LIMIT, not a Postgres error', async () => {
    const room = await nodes.createRoom(ownerId, 'Deep');
    let current = room.id;

    // Down to the cap. The last legal folder sits at depth MAX_DEPTH.
    for (let depth = 1; depth <= MAX_DEPTH; depth += 1) {
      current = (await nodes.createFolder(current, `Level ${depth}`)).id;
    }

    const rejection = await nodes.createFolder(current, 'One too deep').catch((cause: unknown) => cause);

    // The point of the declaration: a raw btree "index row size exceeds
    // maximum" is not something a client can act on, and it arrives from a
    // layer that has no idea what a folder is.
    expect((rejection as { code?: string }).code).toBe('DEPTH_LIMIT');
    expect(String(rejection)).not.toMatch(/index row size|btree|postgres/i);
  });

  it('API-NODES-009 a cascade delete leaves nothing half-done', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const branch = await nodes.createFolder(room.id, 'Branch');
    const inner = await nodes.createFolder(branch.id, 'Inner');
    const leaf = await nodes.createFolder(inner.id, 'Leaf');
    const sibling = await nodes.createFolder(room.id, 'Sibling');

    const { deletedIds } = await nodes.softDelete(branch.id);

    expect(new Set(deletedIds)).toEqual(new Set([branch.id, inner.id, leaf.id]));
    for (const id of deletedIds) {
      expect((await nodes.findById(id))?.deletedAt, id).not.toBeNull();
    }
    // The sibling subtree is untouched — a prefix that over-matches would take
    // it too, and fixed-width UUID segments are what stop that.
    expect((await nodes.findById(sibling.id))?.deletedAt).toBeNull();

    await assertTreeIsConsistent();
  });

  it('API-NODES-011 ten concurrent creations of one name produce ten distinct names', async () => {
    const room = await nodes.createRoom(ownerId, 'Busy');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => nodes.createFolder(room.id, 'Q4 Report')),
    );

    const names = results.map((node) => node.name);
    // Ten distinct names and no 500s. A pre-check-then-insert would have nine
    // of these read the same sibling set, pick the same suffix, and collide.
    expect(new Set(names).size).toBe(10);
    expect(names).toContain('Q4 Report');
    await assertTreeIsConsistent();
  });

  it('API-NODES-019 subtree stats match a naive recursive walk', async () => {
    const room = await nodes.createRoom(ownerId, 'Counted');
    const a = await nodes.createFolder(room.id, 'A');
    const b = await nodes.createFolder(a.id, 'B');
    await nodes.createFolder(b.id, 'C');
    await nodes.createFolder(room.id, 'D');

    const stats = await nodes.statsFor(room.id);

    // Recomputed by walking parent_id, not by a second prefix query — the point
    // is to check the prefix aggregate against something that does not share its
    // assumptions.
    const rows = await allRows();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const descendants = rows.filter(
      (row) => row.id !== room.id && walkAncestors(byId, row.id).includes(room.id),
    );

    expect(stats.folders).toBe(descendants.length);
    expect(stats.files).toBe(0);
  });

  it('API-NODES-020 rebuildSubtree repairs derived state from parent_id alone', async () => {
    const room = await nodes.createRoom(ownerId, 'Corrupt');
    const parent = await nodes.createFolder(room.id, 'Parent');
    const child = await nodes.createFolder(parent.id, 'Child');

    // Deliberate corruption of exactly the derived columns, the way a bad
    // migration would leave them.
    // A tagged template, not `$executeRawUnsafe` with a `$1` placeholder: Prisma
    // sends unsafe-raw parameters as jsonb, so the cast fails with
    // "cannot cast type jsonb to uuid". The tagged form types them properly.
    await prisma.$executeRaw`
      UPDATE "nodes"
         SET "path" = '/wrong/' || "id"::text, "depth" = 7
       WHERE "id" = ${child.id}::uuid
    `;

    const repaired = await nodes.rebuildSubtree(room.id);

    expect(repaired).toBeGreaterThan(0);
    // This is the escape hatch's whole justification: `parent_id` was never
    // derived, so it is still right when everything computed from it is wrong.
    await assertTreeIsConsistent();
  });
});
