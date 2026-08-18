import { randomUUID } from 'node:crypto';

import { PAGE_SIZE, type ChildrenPage, type NodeDetail } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { NodesRepository, NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * The children listing, **over HTTP**.
 *
 * These are the first tests in the repository that go through the real request
 * pipeline — `SessionGuard`, then `NodeAccessGuard`, then a controller — rather
 * than calling a service. That is deliberate and it is the point of the module
 * they cover: the tree and the permission resolver both worked for a week before
 * any route reached them, so "it works" had never once meant "it works when a
 * request asks for it".
 *
 * The ordering and pagination declarations are stated against non-ASCII names
 * throughout. A collation mismatch between the keyset cursor and the `ORDER BY`
 * is invisible with ASCII data, which is precisely how it ships.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let repository: NodesRepository;
let server: Parameters<typeof request>[0];
let token: string;
let ownerId: string;

const PASSWORD = 'a-real-password-2026';

beforeAll(async () => {
  app = await createTestApp();
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
  repository = app.module.get(NodesRepository);
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);

  const user = await prisma.user.create({
    data: {
      email: `owner-${randomUUID().slice(0, 8)}@example.com`,
      name: 'Ana Ruiz',
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  ownerId = user.id;

  // A real login rather than a hand-minted JWT: the token these tests carry is
  // the same token the product issues, so a change to how sessions are signed
  // breaks this suite instead of silently leaving it testing a fiction.
  const session = await app.module.get(AuthService).login(user.email, PASSWORD);
  token = session.accessToken;
});

/**
 * A file node, created through the repository.
 *
 * `files` does not exist yet, so there is no upload lifecycle to go through —
 * but the ordering declaration is specifically about folders sorting before
 * files, and a suite that substituted a folder would assert nothing. The
 * repository is still the application's own code path, so this cannot create a
 * row the application could not: the seven CHECK constraints apply either way.
 */
async function makeFile(parentId: string, name: string): Promise<string> {
  const parent = await repository.findById(parentId);
  const path = await repository.pathOf(parentId);
  if (parent === null || path === null) throw new Error(`No such parent: ${parentId}`);

  const file = await repository.createChild({
    id: randomUUID(),
    type: 'file',
    parent: { ...parent, path },
    name,
  });
  return file.id;
}

async function listChildren(parentId: string, query = ''): Promise<ChildrenPage> {
  const response = await request(server)
    .get(`/nodes/${parentId}/children${query}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(200);

  return response.body as ChildrenPage;
}

/** Every page, followed to the end, with a guard against a cursor that never advances. */
async function pageThrough(parentId: string, limit: number): Promise<ChildrenPage['items']> {
  const collected: ChildrenPage['items'] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 200; page += 1) {
    const suffix: string = cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
    const body: ChildrenPage = await listChildren(parentId, suffix);

    collected.push(...body.items);
    if (body.nextCursor === null) return collected;
    cursor = body.nextCursor;
  }

  throw new Error('Pagination did not terminate in 200 pages — the cursor is not advancing');
}

describe('listing children', () => {
  it('API-NODES-015 children come back folders first, then by name, then by id', async () => {
    const room = await nodes.createRoom(ownerId, 'Ordering');

    // Interleaved on purpose, and named so that name-order and creation-order
    // disagree: a listing that happened to return insertion order would pass a
    // weaker fixture.
    await makeFile(room.id, 'aaa.pdf');
    await nodes.createFolder(room.id, 'Ømsorg');
    await makeFile(room.id, 'Звіт.pdf');
    await nodes.createFolder(room.id, 'café');
    await makeFile(room.id, 'bbb.pdf');
    await nodes.createFolder(room.id, 'Bilan');

    const page = await listChildren(room.id);
    const types = page.items.map((item) => item.type);
    const names = page.items.map((item) => item.name);

    // Folders before files, with no interleaving anywhere in the page. Asserted
    // as "no file precedes a folder" rather than by comparing to a hand-written
    // list, so the assertion states the property instead of restating the
    // fixture.
    expect(types.indexOf('file')).toBeGreaterThan(-1);
    expect(types.lastIndexOf('folder')).toBeLessThan(types.indexOf('file'));

    // Within each type, byte order — which is what `COLLATE "C"` means and what
    // index `nodes_children_listing` is built on. Under the database's own
    // en_US.utf8 collation `café` would sort before `Bilan`; it must not here.
    const folders = names.slice(0, types.indexOf('file'));
    const files = names.slice(types.indexOf('file'));
    expect(folders).toEqual([...folders].sort(byBytes));
    expect(files).toEqual([...files].sort(byBytes));
  });

  it('API-NODES-016 paging 500 Cyrillic and accented children loses and duplicates nothing', async () => {
    const room = await nodes.createRoom(ownerId, 'Велика кімната');

    // Non-ASCII throughout, and deliberately including names that differ only
    // in an accent or in case — the pairs a collation gets wrong at exactly the
    // page boundary where a cursor comparison disagrees with the ORDER BY.
    const alphabet = ['Ґанок', 'Ганок', 'café', 'cafe', 'Café', 'Ärende', 'Arende', '契約', 'Đầu', 'straße'];
    const created: string[] = [];
    for (let index = 0; index < 500; index += 1) {
      const name = `${alphabet[index % alphabet.length] ?? 'x'} ${index}`;
      created.push((await nodes.createFolder(room.id, name)).id);
    }

    const seen = await pageThrough(room.id, 50);
    const ids = seen.map((item) => item.id);

    // Three separate failures, three separate assertions: a page that drops a
    // row, a page that repeats its boundary row, and a cursor that walks off the
    // end early all look identical in a single length check.
    expect(new Set(ids).size, 'duplicated rows across pages').toBe(ids.length);
    expect(ids.length, 'rows lost across pages').toBe(500);
    expect(new Set(ids)).toEqual(new Set(created));
  }, 60_000);

  it('API-NODES-017 the cursor compares under the same collation the ORDER BY uses', async () => {
    const room = await nodes.createRoom(ownerId, 'Collation');

    // These four sort differently under C and under en_US.utf8, which is the
    // database's actual collation here:
    //   C          Zebra < apple < banana < Ápple   (byte order)
    //   en_US.utf8 apple < Ápple < banana < Zebra   (linguistic)
    // If the cursor compared linguistically while the index ordered by bytes,
    // paging one row at a time would skip rows rather than merely reorder them.
    for (const name of ['apple', 'Ápple', 'banana', 'Zebra']) {
      await nodes.createFolder(room.id, name);
    }

    const oneAtATime = (await pageThrough(room.id, 1)).map((item) => item.name);
    const wholePage = (await listChildren(room.id)).items.map((item) => item.name);

    expect(oneAtATime).toEqual(['Zebra', 'apple', 'banana', 'Ápple']);

    // The property that actually matters, stated independently of the fixture:
    // walking the cursor must visit exactly what one unpaginated page contains,
    // in the same order. This is the assertion that fails when the index and the
    // cursor disagree, whatever the collation happens to be.
    expect(oneAtATime).toEqual(wholePage);
  });

  it('API-NODES-018 breadcrumbs arrive with the page rather than in a second request', async () => {
    const room = await nodes.createRoom(ownerId, 'Meridian');
    const diligence = await nodes.createFolder(room.id, 'Diligence');
    const quarter = await nodes.createFolder(diligence.id, 'Q4');
    await nodes.createFolder(quarter.id, 'Contracts');

    const page = await listChildren(quarter.id);

    // Root first, ending in the listed node itself — so a client renders the
    // whole trail from one response. The declaration's "without a second query"
    // is this: no round trip per crumb, which is what the previous
    // implementation cost before `findManyByIds`.
    expect(page.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Meridian', 'Diligence', 'Q4']);
    expect(page.breadcrumbs.map((crumb) => crumb.type)).toEqual(['room', 'folder', 'folder']);
    expect(page.items.map((item) => item.name)).toEqual(['Contracts']);
  });
});

describe('the tree over HTTP', () => {
  it('API-NODES-022 a stranger gets 404 for a node they cannot read, not 403', async () => {
    const room = await nodes.createRoom(ownerId, 'Private');

    const stranger = await prisma.user.create({
      data: {
        email: `stranger-${randomUUID().slice(0, 8)}@example.com`,
        name: 'Someone Else',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const theirSession = await app.module.get(AuthService).login(stranger.email, PASSWORD);

    const denied = await request(server)
      .get(`/nodes/${room.id}`)
      .set('Authorization', `Bearer ${theirSession.accessToken}`)
      .expect(404);

    const nonexistent = await request(server)
      .get(`/nodes/${randomUUID()}`)
      .set('Authorization', `Bearer ${theirSession.accessToken}`)
      .expect(404);

    // Byte-identical, not merely both-404. A 403, or two 404s differing by one
    // field, is an enumeration oracle across every room in the system — see
    // `API-ACCESS-011`, which this extends to a real route for the first time.
    expect(denied.body).toEqual(nonexistent.body);
    expect(denied.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });

  it('API-NODES-023 creating a folder under a parent the caller cannot write is a 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Someone else’s room');

    const stranger = await prisma.user.create({
      data: {
        email: `intruder-${randomUUID().slice(0, 8)}@example.com`,
        name: 'Intruder',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const theirSession = await app.module.get(AuthService).login(stranger.email, PASSWORD);

    // `POST /nodes/folders` names its parent in the **body**, so
    // `NodeAccessGuard` never fires for it — the route has no `:id`. Before the
    // controller called `NodeAccessResolver` explicitly, this request created a
    // folder in a stranger's room and returned 201.
    await request(server)
      .post('/nodes/folders')
      .set('Authorization', `Bearer ${theirSession.accessToken}`)
      .send({ parentId: room.id, name: 'Uninvited' })
      .expect(404);

    expect((await listChildren(room.id)).items).toHaveLength(0);
  });

  it('API-NODES-024 moving a node into a destination the caller cannot write is a 404', async () => {
    const mine = await nodes.createRoom(ownerId, 'Mine');
    const movable = await nodes.createFolder(mine.id, 'Movable');

    const other = await prisma.user.create({
      data: {
        email: `other-${randomUUID().slice(0, 8)}@example.com`,
        name: 'Other Owner',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const theirRoom = await nodes.createRoom(other.id, 'Theirs');

    // The guard authorizes the node being *moved* and says nothing about where
    // it lands. Without the destination check this succeeded, putting a folder
    // into someone else's room using only the caller's own permissions.
    await request(server)
      .patch(`/nodes/${movable.id}/parent`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parentId: theirRoom.id })
      .expect(404);

    const unchanged = await nodes.findById(movable.id);
    expect(unchanged?.parentId).toBe(mine.id);
  });

  it('API-NODES-025 a tampered cursor is rejected rather than silently returning page one', async () => {
    const room = await nodes.createRoom(ownerId, 'Signed');
    await nodes.createFolder(room.id, 'One');
    await nodes.createFolder(room.id, 'Two');

    const first = await listChildren(room.id, '?limit=1');
    expect(first.nextCursor).not.toBeNull();

    // Flip the signature. An unsigned cursor would let a caller craft a
    // position and, because the tuple carries a name, probe whether a given
    // name exists in a folder without listing it.
    const tampered = `${(first.nextCursor ?? '').slice(0, -4)}AAAA`;

    const response = await request(server)
      .get(`/nodes/${room.id}/children?cursor=${encodeURIComponent(tampered)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_FAILED');
  });

  it('API-NODES-026 the rooms listing shows only the caller’s own rooms', async () => {
    await nodes.createRoom(ownerId, 'Ours');

    const other = await prisma.user.create({
      data: {
        email: `neighbour-${randomUUID().slice(0, 8)}@example.com`,
        name: 'Neighbour',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    await nodes.createRoom(other.id, 'Theirs');

    const response = await request(server)
      .get('/nodes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ChildrenPage;
    expect(body.items.map((item) => item.name)).toEqual(['Ours']);
  });

  it('API-NODES-027 a room, a folder and a rename round-trip through the API', async () => {
    const roomResponse = await request(server)
      .post('/nodes')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Project Meridian' })
      .expect(201);
    const room = roomResponse.body as NodeDetail;

    const folderResponse = await request(server)
      .post('/nodes/folders')
      .set('Authorization', `Bearer ${token}`)
      .send({ parentId: room.id, name: 'Diligence' })
      .expect(201);
    const folder = folderResponse.body as NodeDetail;

    expect(folder.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Project Meridian', 'Diligence']);
    expect(folder.depth).toBe(1);
    expect(folder.rootId).toBe(room.id);

    const renamed = await request(server)
      .patch(`/nodes/${folder.id}/name`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Due Diligence' })
      .expect(200);
    expect((renamed.body as NodeDetail).name).toBe('Due Diligence');

    await request(server)
      .delete(`/nodes/${folder.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect((await listChildren(room.id)).items).toHaveLength(0);
  });

  it('API-NODES-028 a page never exceeds PAGE_SIZE, and an over-large limit is refused', async () => {
    const room = await nodes.createRoom(ownerId, 'Capped');
    for (let index = 0; index < PAGE_SIZE + 5; index += 1) {
      await nodes.createFolder(room.id, `Folder ${index}`);
    }

    // The default page, on a folder with more children than fit in one.
    const page = await listChildren(room.id);
    expect(page.items).toHaveLength(PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();

    // An unbounded limit would turn one request into a full read of somebody's
    // largest folder. `PageQuerySchema` bounds it at PAGE_SIZE by **rejecting**
    // rather than clamping, which is the better of the two: a silently clamped
    // request returns a short page that looks like the end of the data, and a
    // client paging on `items.length === limit` stops early and loses rows.
    await request(server)
      .get(`/nodes/${room.id}/children?limit=5000`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    // Malformed rather than merely too large — `Number('banana')` is NaN, which
    // the schema refuses. `parseInt` would have read `50abc` as 50.
    await request(server)
      .get(`/nodes/${room.id}/children?limit=banana`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  }, 30_000);
});

/** Byte order — what `COLLATE "C"` means, expressed without a database. */
function byBytes(left: string, right: string): number {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.compare(b);
}
