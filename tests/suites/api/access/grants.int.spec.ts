import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NODE_LOOKUP, ShareCodec, SharesRepository, type NodeLookupPort } from '@api/access';
import type { PrismaService } from '@api/common';
import { NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';
import { makeUser } from '@support/factories';

let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let shares: SharesRepository;
let codec: ShareCodec;
let lookup: NodeLookupPort;
let ownerId: string;

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
  shares = app.module.get(SharesRepository);
  codec = app.module.get(ShareCodec);
  lookup = app.module.get<NodeLookupPort>(NODE_LOOKUP);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  ownerId = (await makeUser(prisma)).id;
});

async function createLink(
  nodeId: string,
  options: { expiresAt?: Date; revokedAt?: Date } = {},
): Promise<{ id: string; token: string }> {
  const token = codec.mintToken();
  const share = await shares.create({
    id: randomUUID(),
    nodeId,
    kind: 'public_link',
    role: 'viewer',
    tokenHash: codec.hash(token),
    createdById: ownerId,
    expiresAt: options.expiresAt ?? null,
    revokedAt: options.revokedAt ?? null,
  });
  return { id: share.id, token };
}

describe('grants that must not resolve', () => {
  it('API-ACCESS-009 expired and revoked grants are excluded in SQL, not filtered in JS', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const live = await createLink(room.id);
    await createLink(room.id, { expiresAt: new Date(Date.now() - 60_000) });
    await createLink(room.id, { revokedAt: new Date(Date.now() - 60_000) });

    const rows = await prisma.share.count({ where: { nodeId: room.id } });
    expect(rows, 'all three rows exist').toBe(3);

    const grants = await shares.liveGrantsFor([room.id]);

    // One, not three-then-filtered. This is what lets `resolveAccess` stay a pure
    // function that never reads a clock — and why API-ACCESS-007 needs no stub.
    expect(grants).toHaveLength(1);
    expect(grants[0]?.id).toBe(live.id);
  });

  it('API-ACCESS-019 a credential lookup returns null for unknown, revoked, and expired alike', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const revoked = await createLink(room.id, { revokedAt: new Date(Date.now() - 1000) });
    const expired = await createLink(room.id, { expiresAt: new Date(Date.now() - 1000) });

    for (const credential of [revoked.token, expired.token, codec.mintToken()]) {
      // All three indistinguishable at the source, so no caller can accidentally
      // tell them apart. This is the API half of the one-failure-screen decision.
      // The repository takes the plaintext now, so hashing and the choice of
      // which unique column to probe are one decision in one place rather than
      // something each caller re-derives. See `ShareCodec.credentialColumn`.
      await expect(shares.findLiveByCredential(credential)).resolves.toBeNull();
    }
  });
});

describe('denial and boundaries', () => {
  it('API-ACCESS-012 resolution issues one grant query regardless of depth', async () => {
    const room = await nodes.createRoom(ownerId, 'Deep');
    let current = room.id;
    for (let depth = 1; depth <= 8; depth += 1) {
      current = (await nodes.createFolder(current, `Level ${depth}`)).id;
    }

    const snapshot = await lookup.findSnapshot(current);
    expect(snapshot?.ancestorIds).toHaveLength(8);

    // Count the statements the grant fetch actually issues.
    const statements: string[] = [];
    const listener = (event: { query: string }): void => {
      if (/FROM "public"\."shares"|FROM "shares"/i.test(event.query)) statements.push(event.query);
    };

    const instrumented = app.module.get(SharesRepository);
    prisma.$on('query' as never, listener as never);
    await instrumented.liveGrantsFor([...(snapshot?.ancestorIds ?? []), current]);

    // Nine node ids, one query. A per-ancestor lookup would be nine round trips
    // and would make depth a latency problem — the materialized path exists so
    // the ancestor ids are known before any grant is fetched.
    expect(statements.length, statements.join('\n')).toBeLessThanOrEqual(1);
  });

  it('API-ACCESS-020 the NODE_LOOKUP port is bound and returns ancestry without access importing nodes', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const folder = await nodes.createFolder(room.id, 'Folder');
    const child = await nodes.createFolder(folder.id, 'Child');

    const snapshot = await lookup.findSnapshot(child.id);

    // The one inverted dependency in the system, exercised end to end: `access`
    // asked for ancestry and `nodes` answered, with neither importing the other.
    expect(snapshot).toMatchObject({
      id: child.id,
      rootId: room.id,
      ownerId,
      ancestorIds: [room.id, folder.id],
      ancestorsDeleted: false,
    });

    await nodes.softDelete(folder.id);
    const afterDelete = await lookup.findSnapshot(child.id);

    // The flag the resolver cannot compute for itself. Without it the
    // deleted-ancestor rule is unenforceable in a pure function.
    expect(afterDelete?.ancestorsDeleted).toBe(true);
  });
});
