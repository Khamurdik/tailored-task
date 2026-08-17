import { randomUUID } from 'node:crypto';

import type { CreatedShare, ResolveShareResponse } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * `GET /shares/resolve` — the only anonymous, attacker-reachable route.
 *
 * The indistinguishability group is why this module exists separately at all,
 * and `API-LINKS-004` is the one test that would catch the whole design failing:
 * three tests each asserting "404" pass happily while the bodies differ by a
 * single field, which is all an oracle needs.
 *
 * The throttler is bypassed here and exercised on its own in
 * `throttle.int.spec.ts` — with a 20/minute budget shared across an app
 * instance, a suite this size would otherwise start failing with 429s that look
 * like resolution bugs.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let server: Parameters<typeof request>[0];
let ownerToken: string;
let ownerId: string;

const PASSWORD = 'a-real-password-2026';

beforeAll(async () => {
  app = await createTestApp({ withoutThrottling: true });
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);

  const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: 'Owner', passwordHash: await hashPassword(PASSWORD) },
  });
  ownerId = user.id;
  ownerToken = (await app.module.get(AuthService).login(email, PASSWORD)).accessToken;
});

async function createLink(nodeId: string, body: Record<string, unknown> = {}): Promise<CreatedShare> {
  const response = await request(server)
    .post(`/nodes/${nodeId}/shares`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ kind: 'public_link', ...body })
    .expect(201);

  return response.body as CreatedShare;
}

function resolve(credential: string) {
  return request(server).get('/shares/resolve').set('X-Share-Token', credential);
}

/** Status, body and the headers that are part of the contract — the whole response. */
function fingerprint(response: request.Response): unknown {
  return {
    status: response.status,
    body: response.body,
    referrerPolicy: response.headers['referrer-policy'],
    cacheControl: response.headers['cache-control'],
    contentType: response.headers['content-type'],
  };
}

describe('one failure, indistinguishable', () => {
  it('API-LINKS-001 an unknown credential resolves to 404', async () => {
    const response = await resolve('Tm90aGluZ0hlcmVBdEFsbFdoYXRzb2V2ZXJOb3BlTm9wZQ');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });

  it('API-LINKS-002 a revoked share’s credential resolves to 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id);

    await expect(resolve(created.token ?? '').expect(200)).resolves.toBeTruthy();

    await request(server)
      .delete(`/shares/${created.share.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    await resolve(created.token ?? '').expect(404);
  });

  it('API-LINKS-003 an expired share’s credential resolves to 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await resolve(created.token ?? '').expect(404);
  });

  it('API-LINKS-004 unknown, revoked, expired, and deleted-target are byte-identical', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');

    const revoked = await createLink(await folder(room.id, 'Revoked'));
    await request(server)
      .delete(`/shares/${revoked.share.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    const expired = await createLink(await folder(room.id, 'Expired'), {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const deletedTarget = await folder(room.id, 'Deleted');
    const pointingAtDeleted = await createLink(deletedTarget);
    await request(server)
      .delete(`/nodes/${deletedTarget}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // Sequential rather than `Promise.all`: supertest calls `listen()` on the
    // server it is given, and concurrent calls race that into ECONNRESET.
    const credentials = [
      'Tm90aGluZ0hlcmVBdEFsbFdoYXRzb2V2ZXJOb3BlTm9wZQ', // never existed
      revoked.token ?? '',
      expired.token ?? '',
      pointingAtDeleted.token ?? '',
      '%%%not-even-well-formed%%%', // malformed
      '', // absent
    ];

    const responses: request.Response[] = [];
    for (const credential of credentials) responses.push(await resolve(credential));

    // One comparison over the whole response rather than four assertions of
    // "404". Status, body, and the security headers all have to match, because
    // any one of them differing is an oracle.
    const [first, ...rest] = responses.map(fingerprint);
    for (const [index, candidate] of rest.entries()) {
      expect(candidate, `response ${index + 1} differs from the first`).toEqual(first);
    }
    expect(first).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });

  it('API-LINKS-005 a malformed credential is refused like an unknown one, not as a validation error', async () => {
    // A zod schema on the header would reject a 12-character guess with
    // VALIDATION_FAILED, which tells an attacker their guess had the wrong
    // *shape* — a free filter on the search space that costs them nothing
    // against the throttle. This route must not validate before it looks up.
    for (const malformed of ['short', '!!!!', 'x'.repeat(500), '../../etc/passwd', '  ']) {
      const response = await resolve(malformed);
      expect(response.status, malformed).toBe(404);
      expect(response.body, malformed).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }
  });

  it('API-LINKS-006 a credential whose node has a deleted ancestor resolves to 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const branch = await folder(room.id, 'Branch');
    const inner = await folder(branch, 'Inner');

    const created = await createLink(inner);
    await resolve(created.token ?? '').expect(200);

    // The *ancestor* is deleted, not the target. The grant itself is revoked by
    // the cascade too, but the resolver would refuse it regardless: a node under
    // a deleted parent is readable by nobody, including its owner.
    await request(server)
      .delete(`/nodes/${branch}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    await resolve(created.token ?? '').expect(404);
  });
});

describe('resolution', () => {
  it('API-LINKS-014 a valid token resolves to the share’s root node id and role', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const shared = await folder(room.id, 'Shared');
    const created = await createLink(shared);

    const response = await resolve(created.token ?? '').expect(200);
    const body = response.body as ResolveShareResponse;

    expect(body.rootNodeId).toBe(shared);
    expect(body.role).toBe('viewer');
    expect(body.expiresAt).toBeNull();
  });

  it('API-LINKS-015 the token and the short code for one share return byte-identical bodies', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id, { shortLink: true });

    const viaToken = await resolve(created.token ?? '').expect(200);
    const viaCode = await resolve(created.shortCode ?? '').expect(200);

    // A short code is a second *spelling* of one grant, not a second grant —
    // so nothing downstream may be able to tell which was presented.
    expect(fingerprint(viaCode)).toEqual(fingerprint(viaToken));

    // And the code round-trips through Crockford's confusable mapping.
    const retyped = (created.shortCode ?? '').toLowerCase().replace(/1/g, 'l').replace(/0/g, 'O');
    expect(fingerprint(await resolve(retyped).expect(200))).toEqual(fingerprint(viaToken));
  });

  it('API-LINKS-016 the response carries no node name, type, or child count', async () => {
    const room = await nodes.createRoom(ownerId, 'Confidential Project Meridian');
    const created = await createLink(room.id);

    const response = await resolve(created.token ?? '').expect(200);

    // Three keys and no more. Inlining a summary would give the anonymous path
    // a second way to learn about a node — one that did not pass through
    // `NodeAccessGuard` — and the room's *name* is the first thing it would leak.
    expect(Object.keys(response.body as object).sort()).toEqual([
      'expiresAt',
      'role',
      'rootNodeId',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('Meridian');
  });

  it('API-LINKS-017 resolution issues no session, no cookie, and no token pair', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id);

    const response = await resolve(created.token ?? '').expect(200);

    // A visitor stays anonymous and presents the credential on every request.
    // Issuing a session here would create a second thing to revoke, and
    // revoking the grant would no longer be enough.
    expect(response.headers['set-cookie']).toBeUndefined();
    const body = response.body as Record<string, unknown>;
    expect(body['accessToken']).toBeUndefined();
    expect(body['refreshToken']).toBeUndefined();
  });

  it('API-LINKS-012 a share created without shortLink has a null short_code_hash and no code resolves', async () => {
    const room = await nodes.createRoom(ownerId, 'No Code');
    const created = await createLink(room.id);

    expect(created.shortCode).toBeNull();
    expect(created.share.hasShortCode).toBe(false);

    const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });
    expect(row.shortCodeHash).toBeNull();

    // Opt-in means opt-in: no code exists, so no 16-character string can reach
    // this grant. A null column must not match a null-ish lookup either.
    await resolve('0000000000000000').expect(404);
    await resolve('ZZZZZZZZZZZZZZZZ').expect(404);
  });
});

describe('leakage and headers', () => {
  it('API-LINKS-019 no response from this module contains a plaintext token or code', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id, { shortLink: true });

    const responses = [
      await resolve(created.token ?? '').expect(200),
      await resolve(created.shortCode ?? '').expect(200),
      await resolve('unknown-credential').expect(404),
    ];

    for (const response of responses) {
      const whole = JSON.stringify(response.body) + JSON.stringify(response.headers);
      expect(whole).not.toContain(created.token);
      expect(whole).not.toContain(created.shortCode);
    }
  });

  it('API-LINKS-020 the credential never reaches a log line for this route', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id, { shortLink: true });

    const written: string[] = [];
    const restore = [process.stdout, process.stderr].map((stream) => {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        written.push(String(chunk));
        return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      return () => {
        stream.write = original;
      };
    });

    try {
      await resolve(created.token ?? '').expect(200);
      await resolve(created.shortCode ?? '').expect(200);
      await resolve('a-guess-that-will-not-work').expect(404);
    } finally {
      for (const undo of restore) undo();
    }

    const log = written.join('');
    expect(log).not.toContain(created.token);
    expect(log).not.toContain(created.shortCode);
  });

  it('API-LINKS-021 the response sets Referrer-Policy: no-referrer and Cache-Control: no-store', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const created = await createLink(room.id);

    for (const response of [
      await resolve(created.token ?? '').expect(200),
      await resolve('nothing').expect(404),
    ]) {
      // On the failure response too. If the header set differed between the two
      // outcomes it would be one more way to tell them apart, which is exactly
      // what API-LINKS-004 forbids.
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });
});

async function folder(parentId: string, name: string): Promise<string> {
  return (await nodes.createFolder(parentId, name)).id;
}
