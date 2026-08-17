import { randomUUID } from 'node:crypto';

import { MAX_FILE_SIZE, type ContentUrlResponse, type InitUploadResponse, type NodeDetail } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { FilesService } from '@api/files';
import { NodesService } from '@api/nodes';
import { objectKey } from '@api/storage';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * The upload lifecycle, against a real database and the in-memory bucket.
 *
 * The fake stands in for one thing only: the browser's direct PUT to S3, which
 * never passes through the API and therefore has no port method. Everything
 * else — the pending row, the name reservation, the `HeadObject`, the magic-byte
 * read, the rollups — is the real code path.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let files: FilesService;
let server: Parameters<typeof request>[0];
let token: string;
let ownerId: string;
let roomId: string;

const PASSWORD = 'a-real-password-2026';

/** A minimal but genuine PDF: the magic bytes are the first five. */
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
/** HTML that *claims* to be a PDF — the case the byte check exists for. */
const HTML = Buffer.from('<!doctype html><script>alert(document.cookie)</script>');

beforeAll(async () => {
  app = await createTestApp({ withoutThrottling: true });
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
  files = app.module.get(FilesService);
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  app.storage.reset();

  const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: 'Owner', passwordHash: await hashPassword(PASSWORD) },
  });
  ownerId = user.id;
  token = (await app.module.get(AuthService).login(email, PASSWORD)).accessToken;
  roomId = (await nodes.createRoom(ownerId, 'Documents')).id;
});

async function init(
  body: Record<string, unknown>,
  expectStatus = 201,
): Promise<request.Response> {
  return request(server)
    .post('/uploads/init')
    .set('Authorization', `Bearer ${token}`)
    .send({
      parentId: roomId,
      name: 'report.pdf',
      sizeBytes: PDF.byteLength,
      contentType: 'application/pdf',
      ...body,
    })
    .expect(expectStatus);
}

/** What the browser does with the presigned URL, and the only faked step. */
function uploadBytes(nodeId: string, bytes: Buffer, contentType = 'application/pdf'): void {
  app.storage.put(objectKey(roomId, nodeId), bytes, contentType);
}

function complete(nodeId: string, expectStatus: number): request.Test {
  return request(server)
    .post(`/uploads/${nodeId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(expectStatus);
}

describe('init and validation', () => {
  it('API-FILES-001 init reserves the name by inserting a pending node immediately', async () => {
    const response = await init({});
    const body = response.body as InitUploadResponse;

    const row = await prisma.node.findUniqueOrThrow({ where: { id: body.nodeId } });
    expect(row.state).toBe('pending');
    expect(row.type).toBe('file');
    expect(row.name).toBe('report.pdf');
    // Nothing authoritative yet — those arrive from the object at /complete.
    expect(row.sizeBytes).toBeNull();
    expect(row.contentType).toBeNull();

    expect(body.uploadUrl).toContain(body.nodeId);
    expect(body.finalName).toBe('report.pdf');
  });

  it('API-FILES-002 ten concurrent inits for one name yield ten distinct names', async () => {
    // The reason the row is inserted at init rather than at complete: the
    // partial unique index arbitrates *now*, while nothing has been uploaded,
    // rather than at the end when nine uploads have already been spent.
    const responses = await Promise.all(Array.from({ length: 10 }, () => init({})));
    const names = responses.map((response) => (response.body as InitUploadResponse).finalName);

    expect(new Set(names).size).toBe(10);
    expect(names).toContain('report.pdf');
    // The suffix goes before the extension — a file called `report.pdf (2)` does
    // not open in a PDF viewer.
    for (const name of names) expect(name.endsWith('.pdf'), name).toBe(true);
  }, 30_000);

  it('API-FILES-007 a size over MAX_FILE_SIZE is rejected at init', async () => {
    const response = await init({ sizeBytes: MAX_FILE_SIZE + 1 }, 413);

    // 413 with the limit in the body, not a generic 400: the client has a
    // specific thing to tell the user, and the number comes from the server
    // rather than from a constant the bundle may have gone stale on.
    expect(response.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      details: { max: MAX_FILE_SIZE },
    });

    expect(await prisma.node.count({ where: { type: 'file' } })).toBe(0);
  });

  it('API-FILES-003 /complete without an upload returns 400 and leaves the node pending', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;

    // No `uploadBytes` — the tab was closed mid-transfer. One of the four
    // upload states, and the one the reaper exists for.
    await complete(nodeId, 400);

    const row = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    expect(row.state).toBe('pending');
  });
});

describe('what the server trusts', () => {
  it('API-FILES-004 size_bytes comes from the object, not from the client’s claim', async () => {
    // The client declares one size and uploads another. A lying client
    // otherwise produces a perfectly plausible row, and nothing looks wrong
    // until a quota calculation or a download breaks months later.
    const { nodeId } = (await init({ sizeBytes: 9 })).body as InitUploadResponse;
    uploadBytes(nodeId, PDF);

    const response = await complete(nodeId, 201);
    const detail = response.body as NodeDetail;

    expect(detail.sizeBytes).toBe(PDF.byteLength);
    expect(detail.sizeBytes).not.toBe(9);

    const row = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    expect(row.sizeBytes).toBe(PDF.byteLength);
  });

  it('API-FILES-005 content_type comes from the object, not from the client', async () => {
    const { nodeId } = (await init({ contentType: 'application/pdf' })).body as InitUploadResponse;
    // Stored as something else entirely.
    uploadBytes(nodeId, PDF, 'application/x-pdf-but-not-really');

    const response = await complete(nodeId, 201);

    expect((response.body as NodeDetail).contentType).toBe('application/x-pdf-but-not-really');
  });

  it('API-FILES-006 non-PDF bytes declared as application/pdf are rejected on the magic-byte check', async () => {
    const { nodeId } = (await init({ contentType: 'application/pdf' })).body as InitUploadResponse;
    // Declares PDF, stores PDF as the type, and the bytes are HTML. The
    // declared type is exactly what an attacker controls, so the check reads
    // the object instead.
    uploadBytes(nodeId, HTML, 'application/pdf');

    const response = await complete(nodeId, 415);
    expect(response.body).toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('API-FILES-020 a rejected type leaves the node pending and returns 415', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    uploadBytes(nodeId, HTML);

    await complete(nodeId, 415);

    // Left for the reaper on purpose: the name stays reserved while the user
    // retries, and deleting it here would race a retry already in flight.
    const row = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    expect(row.state).toBe('pending');
    expect(row.sizeBytes).toBeNull();
  });

  it('API-FILES-016 completing an upload bumps every ancestor’s rollup counters', async () => {
    const branch = await nodes.createFolder(roomId, 'Diligence');
    const inner = await nodes.createFolder(branch.id, 'Q4');

    const response = await request(server)
      .post('/uploads/init')
      .set('Authorization', `Bearer ${token}`)
      .send({
        parentId: inner.id,
        name: 'contract.pdf',
        sizeBytes: PDF.byteLength,
        contentType: 'application/pdf',
      })
      .expect(201);

    const { nodeId } = response.body as InitUploadResponse;
    app.storage.put(objectKey(roomId, nodeId), PDF, 'application/pdf');
    await complete(nodeId, 201);

    // Every ancestor, not just the parent — the counters are what a listing
    // renders, and a room showing 0 files while a folder inside it shows 1 is
    // the drift this pattern is famous for.
    for (const id of [roomId, branch.id, inner.id]) {
      const row = await prisma.node.findUniqueOrThrow({ where: { id } });
      expect(row.subtreeFiles, `subtreeFiles of ${id}`).toBe(1);
      expect(Number(row.subtreeBytes), `subtreeBytes of ${id}`).toBe(PDF.byteLength);
    }

    // And not the file itself: its own size is `sizeBytes`, and counting it in
    // its own rollup would double it at every level above.
    const file = await prisma.node.findUniqueOrThrow({ where: { id: nodeId } });
    expect(file.subtreeFiles).toBe(0);

    // Completing twice must not count twice. `/complete` is retriable.
    await complete(nodeId, 201);
    const room = await prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.subtreeFiles).toBe(1);
  });
});

describe('cancelling, reaping, and orphans', () => {
  it('API-FILES-015 /abort cleans up on user cancel and frees the name', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    uploadBytes(nodeId, PDF);

    await request(server)
      .post(`/uploads/${nodeId}/abort`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(await prisma.node.findUnique({ where: { id: nodeId } })).toBeNull();
    expect(app.storage.get(objectKey(roomId, nodeId))).toBeNull();

    // The name is free again immediately — a soft delete would have held it
    // against the partial unique index until the hard-delete job caught up.
    const again = (await init({})).body as InitUploadResponse;
    expect(again.finalName).toBe('report.pdf');
  });

  it('API-FILES-008 a pending node with no object is cleared by the reaper after an hour', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;

    // Age the row rather than waiting an hour. Raw SQL is the arrangement here
    // and nowhere else: there is no API for "pretend this is old", and the
    // alternative is a clock abstraction threaded through for one test.
    await prisma.$executeRaw`
      UPDATE "nodes" SET "created_at" = now() - interval '2 hours' WHERE "id" = ${nodeId}::uuid
    `;

    const result = await files.reapPending(new Date(Date.now() - 3_600_000));

    expect(result).toEqual({ scanned: 1, deleted: 1 });
    expect(await prisma.node.findUnique({ where: { id: nodeId } })).toBeNull();
  });

  it('API-FILES-009 the reaper leaves a pending node younger than an hour alone', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;

    const result = await files.reapPending(new Date(Date.now() - 3_600_000));

    // An upload in flight is the *normal* state of a pending row. A reaper that
    // took them would cancel every transfer longer than its own schedule.
    expect(result).toEqual({ scanned: 0, deleted: 0 });
    expect(await prisma.node.findUnique({ where: { id: nodeId } })).not.toBeNull();
  });

  it('API-FILES-010 reaping a pending node frees its name for reuse', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    await prisma.$executeRaw`
      UPDATE "nodes" SET "created_at" = now() - interval '2 hours' WHERE "id" = ${nodeId}::uuid
    `;

    await files.reapPending(new Date(Date.now() - 3_600_000));

    const again = (await init({})).body as InitUploadResponse;
    expect(again.finalName).toBe('report.pdf');
  });

  it('API-FILES-011 reapPending reports what it actually did', async () => {
    // A green run that says `{deleted: 0}` every day is evidence the system is
    // clean. A green run that says nothing is not.
    const empty = await files.reapPending(new Date());
    expect(empty).toEqual({ scanned: 0, deleted: 0 });

    for (let index = 0; index < 3; index += 1) {
      await init({ name: `stale-${index}.pdf` });
    }
    await prisma.$executeRaw`
      UPDATE "nodes" SET "created_at" = now() - interval '2 hours' WHERE "state" = 'pending'
    `;

    expect(await files.reapPending(new Date(Date.now() - 3_600_000))).toEqual({
      scanned: 3,
      deleted: 3,
    });
  });

  it('API-FILES-012 soft-deleting a node does not delete the object', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    uploadBytes(nodeId, PDF);
    await complete(nodeId, 201);

    await request(server)
      .delete(`/nodes/${nodeId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // Keeping it is what makes restore possible, and the only place an object
    // is ever removed is the `hard-delete-expired` job, thirty days later.
    expect(app.storage.get(objectKey(roomId, nodeId))).not.toBeNull();
  });

  it('API-FILES-017 twenty concurrent uploads all land with no orphans in either direction', async () => {
    const initiated = await Promise.all(Array.from({ length: 20 }, () => init({})));
    const ids = initiated.map((response) => (response.body as InitUploadResponse).nodeId);

    for (const id of ids) uploadBytes(id, PDF);
    await Promise.all(ids.map((id) => complete(id, 201)));

    const rows = await prisma.node.findMany({ where: { type: 'file' } });
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.state === 'active')).toBe(true);
    expect(new Set(rows.map((row) => row.name)).size).toBe(20);

    // No orphan in either direction: a row for every object, an object for
    // every row.
    for (const row of rows) expect(app.storage.get(objectKey(roomId, row.id)), row.name).not.toBeNull();

    const room = await prisma.node.findUniqueOrThrow({ where: { id: roomId } });
    expect(room.subtreeFiles).toBe(20);
    expect(Number(room.subtreeBytes)).toBe(20 * PDF.byteLength);
  }, 60_000);
});

describe('serving content', () => {
  it('API-FILES-013 /nodes/:id/content-url is permission-checked and 404s for a stranger', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    uploadBytes(nodeId, PDF);
    await complete(nodeId, 201);

    const strangerEmail = `stranger-${randomUUID().slice(0, 8)}@example.com`;
    await prisma.user.create({
      data: { email: strangerEmail, name: 'Stranger', passwordHash: await hashPassword(PASSWORD) },
    });
    const theirs = await app.module.get(AuthService).login(strangerEmail, PASSWORD);

    // This is the one route that hands a credential — a presigned URL — to
    // whoever asks, so the check in front of it matters more than most.
    await request(server)
      .get(`/nodes/${nodeId}/content-url`)
      .set('Authorization', `Bearer ${theirs.accessToken}`)
      .expect(404);

    await request(server).get(`/nodes/${nodeId}/content-url`).expect(404);
  });

  it('API-FILES-014 the issued content URL expires in sixty seconds', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;
    uploadBytes(nodeId, PDF);
    await complete(nodeId, 201);

    const before = Date.now();
    const response = await request(server)
      .get(`/nodes/${nodeId}/content-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ContentUrlResponse;
    const ttlMs = new Date(body.expiresAt).getTime() - before;

    // A presigned GET cannot be revoked once issued — revoking a share does not
    // kill a URL already handed out — so this TTL is the entire mitigation.
    expect(ttlMs).toBeGreaterThan(0);
    expect(ttlMs).toBeLessThanOrEqual(61_000);
    expect(body.url).toContain('expires-in=60');
  });

  it('API-FILES-021 a pending file has no content URL', async () => {
    const { nodeId } = (await init({})).body as InitUploadResponse;

    // 404 rather than a specific error: whether somebody else's upload has
    // finished is not a fact this endpoint should expose.
    await request(server)
      .get(`/nodes/${nodeId}/content-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
