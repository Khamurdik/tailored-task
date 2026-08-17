import { randomUUID } from 'node:crypto';

import type { ChildrenPage, CreatedShare, ShareSummary } from '@dataroom/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ShareCodec } from '@api/access';
import { AuthService, hashPassword } from '@api/auth';
import type { PrismaService } from '@api/common';
import { NodesService } from '@api/nodes';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * Sharing, end to end.
 *
 * The scoping cases here are the ones a reviewer tries by hand, and they could
 * not be written before `tree` existed: every route `sharing` exposes is
 * `@RequireAccess('own')`, which a share token can never satisfy, so proving
 * "this token cannot read that folder" needs a *readable* node route to point at.
 *
 * The throttler is bypassed for this file. It is framework machinery rather than
 * anything this repo owns, its budget is shared across every request an app
 * instance sees, and a suite that quietly ran out of it would fail with 429s
 * that look like permission bugs. The real one is exercised in
 * `throttle.int.spec.ts`.
 */
let app: TestApp;
let prisma: PrismaService;
let nodes: NodesService;
let codec: ShareCodec;
let server: Parameters<typeof request>[0];
let ownerToken: string;
let ownerId: string;

const PASSWORD = 'a-real-password-2026';

beforeAll(async () => {
  app = await createTestApp({ withoutThrottling: true });
  prisma = app.prisma;
  nodes = app.module.get(NodesService);
  codec = app.module.get(ShareCodec);
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  const user = await makeUser('owner');
  ownerId = user.id;
  ownerToken = user.token;
});

async function makeUser(prefix: string): Promise<{ id: string; email: string; token: string }> {
  const email = `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
  const user = await prisma.user.create({
    data: { email, name: 'Test User', passwordHash: await hashPassword(PASSWORD) },
  });
  const session = await app.module.get(AuthService).login(email, PASSWORD);
  return { id: user.id, email, token: session.accessToken };
}

async function createLink(
  nodeId: string,
  body: Record<string, unknown> = {},
  token = ownerToken,
): Promise<CreatedShare> {
  const response = await request(server)
    .post(`/nodes/${nodeId}/shares`)
    .set('Authorization', `Bearer ${token}`)
    .send({ kind: 'public_link', ...body })
    .expect(201);

  return response.body as CreatedShare;
}

/** A share visitor's request: the credential, and never a bearer token beside it. */
function asVisitor(credential: string) {
  return { 'X-Share-Token': credential };
}

describe('links, scoping, and revocation', () => {
  it('API-SHARING-001 a link opens anonymously, and the same token 404s the moment it is revoked', async () => {
    const room = await nodes.createRoom(ownerId, 'Meridian');
    const created = await createLink(room.id);

    // Anonymous — no Authorization header anywhere in this request.
    await request(server)
      .get(`/nodes/${room.id}`)
      .set(asVisitor(created.token ?? ''))
      .expect(200);

    await request(server)
      .delete(`/shares/${created.share.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    await request(server)
      .get(`/nodes/${room.id}`)
      .set(asVisitor(created.token ?? ''))
      .expect(404);
  });

  it('API-SHARING-002 a token for folder B requesting sibling folder C returns 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const b = await nodes.createFolder(room.id, 'B');
    const c = await nodes.createFolder(room.id, 'C');

    const created = await createLink(b.id);
    const credential = asVisitor(created.token ?? '');

    // The grant applies to B and everything beneath it, and to nothing else.
    await request(server).get(`/nodes/${b.id}`).set(credential).expect(200);

    // Not 403 and not an empty 200 — the id must not be confirmed to exist.
    const denied = await request(server).get(`/nodes/${c.id}`).set(credential).expect(404);
    expect(denied.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
  });

  it('API-SHARING-003 a token for folder B cannot read B’s parent', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const parent = await nodes.createFolder(room.id, 'Parent');
    const b = await nodes.createFolder(parent.id, 'B');
    const inner = await nodes.createFolder(b.id, 'Inner');

    const created = await createLink(b.id);
    const credential = asVisitor(created.token ?? '');

    // Down is allowed, up is not. A grant scopes to its own subtree, and the
    // room above it is the owner's business.
    await request(server).get(`/nodes/${inner.id}`).set(credential).expect(200);
    await request(server).get(`/nodes/${parent.id}`).set(credential).expect(404);
    await request(server).get(`/nodes/${room.id}`).set(credential).expect(404);
  });

  it('API-SHARING-004 the plaintext token appears in exactly one response and never again', async () => {
    const room = await nodes.createRoom(ownerId, 'Once');
    const created = await createLink(room.id, { shortLink: true });

    expect(created.token).toBeTruthy();
    expect(created.shortCode).toBeTruthy();

    // Every other representation of the same grant. There is no endpoint that
    // reads a credential back, so `hasShortCode` is the whole truth available.
    const listed = await request(server)
      .get(`/nodes/${room.id}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const serialised = JSON.stringify(listed.body);
    expect(serialised).not.toContain(created.token);
    expect(serialised).not.toContain(created.shortCode);

    const items = (listed.body as { items: ShareSummary[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.hasShortCode).toBe(true);
  });

  // The title deliberately avoids spelling the digest as "SHA-256": the
  // coverage gate reads any `WORD-123` in a test title as a declaration id, so
  // that spelling registers as an implementation of a test called `SHA-256`.
  it('API-SHARING-005 the stored value is a hash of the token, not the token', async () => {
    const room = await nodes.createRoom(ownerId, 'Hashed');
    const created = await createLink(room.id, { shortLink: true });

    const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });

    expect(row.tokenHash).not.toBe(created.token);
    expect(row.tokenHash).toBe(codec.hash(created.token ?? ''));
    // 64 hex characters — a digest, not a reversible encoding of the token.
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('API-LINKS-013 the stored value for a short code is a hash, never the code', async () => {
    const room = await nodes.createRoom(ownerId, 'Coded');
    const created = await createLink(room.id, { shortLink: true });

    const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });

    expect(created.shortCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(row.shortCodeHash).not.toBe(created.shortCode);
    expect(row.shortCodeHash).toBe(codec.hash(created.shortCode ?? ''));
    expect(row.shortCodeHash).toMatch(/^[0-9a-f]{64}$/);

    // The same slow-hash question as a password, answered differently and on
    // purpose: this is 80 bits of CSPRNG output with nothing to brute-force,
    // and the digest sits on the path of every request a visitor makes.
    expect(row.shortCodeHash).not.toBe(created.shortCode?.toUpperCase());
  });

  it('API-SHARING-006 the plaintext token never reaches a log line', async () => {
    const room = await nodes.createRoom(ownerId, 'Quiet');

    const written: string[] = [];
    const capture = (stream: NodeJS.WriteStream): (() => void) => {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...rest: unknown[]) => {
        written.push(String(chunk));
        return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof stream.write;
      return () => {
        stream.write = original;
      };
    };

    const restoreOut = capture(process.stdout);
    const restoreErr = capture(process.stderr);

    let created: CreatedShare;
    try {
      created = await createLink(room.id, { shortLink: true });
      // Exercise the credential too — a token is far likelier to be logged on
      // the path that *reads* it than on the one that mints it.
      await request(server).get(`/nodes/${room.id}`).set(asVisitor(created.token ?? '')).expect(200);
    } finally {
      restoreOut();
      restoreErr();
    }

    const log = written.join('');
    expect(log).not.toContain(created.token);
    expect(log).not.toContain(created.shortCode);
  });

  it('API-SHARING-007 only an owner may create a share; a share visitor gets 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const folder = await nodes.createFolder(room.id, 'Shared');
    const created = await createLink(folder.id);

    // A viewer holding a live, valid credential for this very node still cannot
    // re-share it. `own` comes from `nodes.owner_id` and no grant can confer it.
    await request(server)
      .post(`/nodes/${folder.id}/shares`)
      .set(asVisitor(created.token ?? ''))
      .send({ kind: 'public_link' })
      .expect(404);

    // Nor may a signed-in stranger.
    const stranger = await makeUser('stranger');
    await request(server)
      .post(`/nodes/${folder.id}/shares`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ kind: 'public_link' })
      .expect(404);

    expect(await prisma.share.count({ where: { nodeId: folder.id } })).toBe(1);
  });

  it('API-SHARING-008 revoking is effective immediately for an in-flight session', async () => {
    const room = await nodes.createRoom(ownerId, 'Live');
    const folder = await nodes.createFolder(room.id, 'Docs');
    const created = await createLink(folder.id);
    const credential = asVisitor(created.token ?? '');

    // The visitor is mid-session: they have already read the folder once.
    await request(server).get(`/nodes/${folder.id}/children`).set(credential).expect(200);

    await request(server)
      .delete(`/shares/${created.share.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // No cache, no grace period, no session to expire — the credential is
    // presented on every request and the resolver's predicate excludes revoked
    // rows, so the very next request is dead.
    await request(server).get(`/nodes/${folder.id}/children`).set(credential).expect(404);
  });

  it('API-SHARING-009 cascade-deleting a parent revokes grants on every descendant', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const branch = await nodes.createFolder(room.id, 'Branch');
    const inner = await nodes.createFolder(branch.id, 'Inner');
    const leaf = await nodes.createFolder(inner.id, 'Leaf');
    const sibling = await nodes.createFolder(room.id, 'Sibling');

    const onInner = await createLink(inner.id);
    const onLeaf = await createLink(leaf.id);
    const onSibling = await createLink(sibling.id);

    await request(server)
      .delete(`/nodes/${branch.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(204);

    // `node.deleted` is emitted after the transaction commits and delivered
    // in-process; give the fire-and-forget listener a turn of the loop.
    await settle();

    for (const created of [onInner, onLeaf]) {
      const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });
      expect(row.revokedAt, `grant ${created.share.id}`).not.toBeNull();
    }

    // The untouched subtree keeps its grant — a cascade that over-reached would
    // revoke this one too.
    const untouched = await prisma.share.findUniqueOrThrow({ where: { id: onSibling.share.id } });
    expect(untouched.revokedAt).toBeNull();
    await request(server)
      .get(`/nodes/${sibling.id}`)
      .set(asVisitor(onSibling.token ?? ''))
      .expect(200);
  });
});

describe('pending grants and binding', () => {
  it('API-SHARING-010 a grant for an email with no user row stays pending', async () => {
    const room = await nodes.createRoom(ownerId, 'Invited');
    const email = `not-yet-${randomUUID().slice(0, 8)}@example.com`;

    const response = await request(server)
      .post(`/nodes/${room.id}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'user', email })
      .expect(201);

    const created = response.body as CreatedShare;
    // A user grant carries no bearer credential. The database refuses one, and
    // a grant addressed to a person that is also a link is not addressed to
    // anyone in particular.
    expect(created.token).toBeNull();
    expect(created.shortCode).toBeNull();

    const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });
    expect(row.principalUserId).toBeNull();
    expect(row.principalEmail).toBe(email);
  });

  it('API-SHARING-012 inserting the user with raw SQL and then logging in binds the grant', async () => {
    const room = await nodes.createRoom(ownerId, 'Invited');
    const folder = await nodes.createFolder(room.id, 'For Bea');
    const email = `bea-${randomUUID().slice(0, 8)}@example.com`;

    await request(server)
      .post(`/nodes/${folder.id}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'user', email })
      .expect(201);

    /**
     * Provisioned by hand, the way an operator does it. **No event fires here**
     * — and that is the point of the declaration: there is exactly one binding
     * mechanism and it is login, so a user who appears by any route at all gets
     * the same behaviour. An earlier design had a `user.created` fast path that
     * could never have fired, because the seeder is a separate process from the
     * bus. See HANDOFF.md §3.13.
     */
    const id = randomUUID();
    const hash = await hashPassword(PASSWORD);
    await prisma.$executeRaw`
      INSERT INTO "users" ("id", "email", "name", "password_hash", "created_at", "updated_at")
      VALUES (${id}::uuid, ${email}::citext, 'Bea', ${hash}, now(), now())
    `;

    // Still pending: inserting a user binds nothing by itself.
    expect(await pendingCount(email)).toBe(1);

    const session = await app.module.get(AuthService).login(email, PASSWORD);
    await settle();

    expect(await pendingCount(email)).toBe(0);
    const bound = await prisma.share.findFirstOrThrow({ where: { principalEmail: email } });
    expect(bound.principalUserId).toBe(id);

    // And the grant now actually works for them.
    await request(server)
      .get(`/nodes/${folder.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  });

  it('API-SHARING-013 claiming is idempotent — logging in twice binds the grant once', async () => {
    const room = await nodes.createRoom(ownerId, 'Repeated');
    const invitee = await makeUser('invitee');

    await request(server)
      .post(`/nodes/${room.id}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ kind: 'user', email: invitee.email })
      .expect(201);

    // It runs on *every* login rather than on a first-login flag, so it has to
    // be a no-op the second time. The update matches only rows whose principal
    // is still null, which is what makes that true.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.module.get(AuthService).login(invitee.email, PASSWORD);
      await settle();
    }

    const rows = await prisma.share.findMany({ where: { principalEmail: invitee.email } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.principalUserId).toBe(invitee.id);
  });
});

describe('listing, moves, and expiry', () => {
  it('API-SHARING-014 the grant list distinguishes direct grants from inherited ones', async () => {
    const room = await nodes.createRoom(ownerId, 'Meridian');
    const diligence = await nodes.createFolder(room.id, 'Diligence');
    const quarter = await nodes.createFolder(diligence.id, 'Q4');

    await createLink(diligence.id);
    await createLink(quarter.id);

    const response = await request(server)
      .get(`/nodes/${quarter.id}/shares`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const items = (response.body as { items: ShareSummary[] }).items;
    expect(items).toHaveLength(2);

    const direct = items.filter((item) => item.inheritedFrom === null);
    const inherited = items.filter((item) => item.inheritedFrom !== null);

    expect(direct).toHaveLength(1);
    expect(direct[0]?.nodeId).toBe(quarter.id);

    // The ancestor is *named*, because "why is this exposed?" is unanswerable
    // otherwise — the grant that exposed it is usually several levels up.
    expect(inherited).toHaveLength(1);
    expect(inherited[0]?.inheritedFrom).toEqual({ id: diligence.id, name: 'Diligence' });
  });

  it('API-SHARING-015 moving a node into a shared folder grants inherited access', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const shared = await nodes.createFolder(room.id, 'Shared');
    const elsewhere = await nodes.createFolder(room.id, 'Elsewhere');
    const document = await nodes.createFolder(elsewhere.id, 'Document');

    const created = await createLink(shared.id);
    const credential = asVisitor(created.token ?? '');

    await request(server).get(`/nodes/${document.id}`).set(credential).expect(404);

    await request(server)
      .patch(`/nodes/${document.id}/parent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parentId: shared.id })
      .expect(200);

    // Inheritance follows the tree. This is the surprising half of the move
    // semantics and the reason the move dialog warns when the destination is
    // shared — declared as a test because the behaviour surprises either way.
    await request(server).get(`/nodes/${document.id}`).set(credential).expect(200);
  });

  it('API-SHARING-016 moving a node out of a shared folder removes inherited access', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const shared = await nodes.createFolder(room.id, 'Shared');
    const elsewhere = await nodes.createFolder(room.id, 'Elsewhere');
    const document = await nodes.createFolder(shared.id, 'Document');

    const created = await createLink(shared.id);
    const credential = asVisitor(created.token ?? '');

    await request(server).get(`/nodes/${document.id}`).set(credential).expect(200);

    await request(server)
      .patch(`/nodes/${document.id}/parent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parentId: elsewhere.id })
      .expect(200);

    await request(server).get(`/nodes/${document.id}`).set(credential).expect(404);
  });

  it('API-SHARING-017 a direct grant on a node survives a move', async () => {
    const room = await nodes.createRoom(ownerId, 'Room');
    const from = await nodes.createFolder(room.id, 'From');
    const to = await nodes.createFolder(room.id, 'To');
    const document = await nodes.createFolder(from.id, 'Document');

    const created = await createLink(document.id);
    const credential = asVisitor(created.token ?? '');

    await request(server)
      .patch(`/nodes/${document.id}/parent`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ parentId: to.id })
      .expect(200);

    // The grant is on the node, not on its position. Only *inherited* access
    // follows the tree.
    await request(server).get(`/nodes/${document.id}`).set(credential).expect(200);
  });

  it('API-SHARING-018 tokens are 32 CSPRNG bytes and two links never collide', async () => {
    const room = await nodes.createRoom(ownerId, 'Entropy');

    const tokens = new Set<string>();
    for (let index = 0; index < 25; index += 1) {
      const created = await createLink(room.id);
      const token = created.token ?? '';

      // 32 bytes base64url is 43 characters with no padding.
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      tokens.add(token);
    }

    expect(tokens.size).toBe(25);
  });

  it('API-SHARING-019 an expired share resolves to 404', async () => {
    const room = await nodes.createRoom(ownerId, 'Expiring');

    const soon = new Date(Date.now() + 300).toISOString();
    const created = await createLink(room.id, { expiresAt: soon });
    const credential = asVisitor(created.token ?? '');

    await request(server).get(`/nodes/${room.id}`).set(credential).expect(200);

    await new Promise((done) => setTimeout(done, 400));

    // Expiry is in the repository's predicate, so it needs no sweep and no
    // clock in the resolver: the grant simply stops being returned.
    await request(server).get(`/nodes/${room.id}`).set(credential).expect(404);
  });

  it('API-SHARING-020 every route this module exposes refuses an anonymous caller', async () => {
    const room = await nodes.createRoom(ownerId, 'Guarded');
    const created = await createLink(room.id);

    /**
     * The property `links` was split out to make assertable: `sharing` is
     * owner-only with **no exceptions**, so this needs no carve-out list.
     *
     * 404 exactly, not "401 or 404". An earlier version of these controllers
     * carried `@RequireAuth()` and answered 401, which says "this route exists
     * and your kind of credential is wrong" — a different answer than the one a
     * signed-in stranger gets, and therefore a way to tell two situations apart
     * that the rest of the system is careful to keep identical.
     */
    const attempts = [
      () => request(server).get(`/nodes/${room.id}/shares`),
      () => request(server).post(`/nodes/${room.id}/shares`).send({ kind: 'public_link' }),
      () => request(server).delete(`/shares/${created.share.id}`),
      // A share visitor is not an owner either, however valid their credential.
      () => request(server).get(`/nodes/${room.id}/shares`).set(asVisitor(created.token ?? '')),
    ];

    // Sequential: supertest calls `listen()` on the server it is handed, and
    // firing these together races that setup into ECONNRESET.
    for (const attempt of attempts) {
      const response = await attempt();
      expect(response.status, `${response.request.method} ${response.request.url}`).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Not found' });
    }

    // And the grant is untouched by all of it.
    const row = await prisma.share.findUniqueOrThrow({ where: { id: created.share.id } });
    expect(row.revokedAt).toBeNull();
  });

  it('API-SHARING-021 a share visitor sees breadcrumbs that stop at the shared node', async () => {
    const room = await nodes.createRoom(ownerId, 'Project Meridian');
    const diligence = await nodes.createFolder(room.id, 'Diligence');
    const quarter = await nodes.createFolder(diligence.id, 'Q4');
    await nodes.createFolder(quarter.id, 'Contracts');

    const created = await createLink(quarter.id);
    const credential = asVisitor(created.token ?? '');

    const visitor = await request(server)
      .get(`/nodes/${quarter.id}/children`)
      .set(credential)
      .expect(200);

    // Not `Project Meridian / Diligence / Q4`. The names of the folders above
    // the share are the shape of the owner's room, and handing them to someone
    // who was given one folder leaks it in the one place strangers actually
    // reach.
    expect((visitor.body as ChildrenPage).breadcrumbs.map((crumb) => crumb.name)).toEqual(['Q4']);

    // The owner, on the same node, still gets the whole trail.
    const owner = await request(server)
      .get(`/nodes/${quarter.id}/children`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect((owner.body as ChildrenPage).breadcrumbs.map((crumb) => crumb.name)).toEqual([
      'Project Meridian',
      'Diligence',
      'Q4',
    ]);
  });
});

async function pendingCount(email: string): Promise<number> {
  return prisma.share.count({ where: { principalEmail: email, principalUserId: null } });
}

/** One turn of the event loop, for the bus's fire-and-forget listeners. */
async function settle(): Promise<void> {
  await new Promise((done) => setTimeout(done, 50));
}
