import { randomUUID } from 'node:crypto';

import type { InitUploadResponse, NodeDetail } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { NodesService } from '@api/nodes';
import { objectKey } from '@api/storage';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * The other half of the toggle, in a file of its own because the policy is read
 * at boot and an app instance has exactly one value of it.
 *
 * The pair matters more than either test alone: `API-FILES-006` shows the bytes
 * being rejected and this shows the *same* bytes accepted, so together they
 * establish that the config value is what decides — not the content type, not
 * the extension, and not something compiled in.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let server: Parameters<typeof request>[0];
let token: string;
let roomId: string;

const PASSWORD = 'a-real-password-2026';
const HTML = Buffer.from('<!doctype html><p>a perfectly ordinary document</p>');

beforeAll(async () => {
  app = await createTestApp({
    withoutThrottling: true,
    env: { UPLOAD_FILE_POLICY: 'all-files' },
  });
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
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
  token = (await app.module.get(AuthService).login(email, PASSWORD)).accessToken;
  roomId = (await nodes.createRoom(user.id, 'Anything Goes')).id;
});

describe('the all-files policy', () => {
  it('API-FILES-018 under all-files the same non-PDF upload is accepted', async () => {
    const initiated = await request(server)
      .post('/uploads/init')
      .set('Authorization', `Bearer ${token}`)
      .send({
        parentId: roomId,
        name: 'notes.html',
        sizeBytes: HTML.byteLength,
        contentType: 'text/html',
      })
      .expect(201);

    const { nodeId } = initiated.body as InitUploadResponse;
    app.storage.put(objectKey(roomId, nodeId), HTML, 'text/html');

    // The identical bytes that `API-FILES-006` rejects with 415.
    const completed = await request(server)
      .post(`/uploads/${nodeId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const detail = completed.body as NodeDetail;
    expect(detail.state).toBe('active');
    expect(detail.contentType).toBe('text/html');
    expect(detail.sizeBytes).toBe(HTML.byteLength);

    /**
     * And the rule the toggle must never reach.
     *
     * The file is accepted, and it is still served `attachment` — because
     * uploads come from the S3 origin, `inline` makes the browser render rather
     * than download, and the viewer frames that URL. If the policy could reach
     * the disposition, `all-files` would turn an uploaded `.html` into stored
     * XSS on an origin the web app's CSP cannot cover, and that CSP is the
     * mitigation the whole `localStorage` token decision rests on.
     */
    const content = await request(server)
      .get(`/nodes/${nodeId}/content-url`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const url = (content.body as { url: string }).url;
    expect(decodeURIComponent(url)).toContain('attachment');
    expect(decodeURIComponent(url)).not.toContain('inline');
  });
});
