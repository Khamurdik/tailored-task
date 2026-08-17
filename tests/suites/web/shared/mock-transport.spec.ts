import axios from 'axios';
import { beforeEach, describe, expect, it } from 'vitest';

import { createMockAdapter } from '@web/shared/mock/adapter';
import { resetMockDb } from '@web/shared/mock/db';

/**
 * The placeholder data layer, exercised through a real axios instance.
 *
 * The point of the adapter seam is that the client stack above it is
 * untouched, so these go through `axios.create(...)` exactly as the app does —
 * not by calling handlers directly.
 *
 * Latency is zeroed here. It is there so loading states are visible while
 * developing; in a test it is just 400ms of nothing.
 */
const client = () =>
  axios.create({
    baseURL: '/api',
    adapter: createMockAdapter({ latencyMs: { min: 0, max: 0 } }),
    validateStatus: () => true,
  });

const ROOM = '10000000-0000-4000-8000-000000000001';
const FINANCIALS = '20000000-0000-4000-8000-000000000002';
const CORPORATE = '20000000-0000-4000-8000-000000000001';
const OWNER = 'Bearer mock-access-00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  resetMockDb();
});

describe('placeholder data layer', () => {
  it('WEB-SHARED-030 serves a login and then an authenticated read', async () => {
    const api = client();

    const login = await api.post('/auth/login', {
      email: 'ana@example.com',
      password: 'change-me-now',
    });
    expect(login.status).toBe(200);
    expect(login.data.user).toMatchObject({ email: 'ana@example.com', isAdmin: true });

    const children = await api.get(`/nodes/${ROOM}/children`, {
      headers: { Authorization: `Bearer ${login.data.accessToken}` },
    });
    expect(children.status).toBe(200);
    // Folders before files, then by name — the same ORDER BY the API specifies.
    expect(children.data.items.map((n: { name: string }) => n.name)).toEqual([
      '01 Corporate',
      '02 Financials',
      '03 Legal',
      'Teaser.pdf',
    ]);
  });

  it('WEB-SHARED-031 returns one indistinguishable failure for every bad login', async () => {
    const api = client();
    const attempts = await Promise.all([
      api.post('/auth/login', { email: 'ana@example.com', password: 'wrong' }),
      api.post('/auth/login', { email: 'nobody@example.com', password: 'wrong' }),
    ]);

    const [wrongPassword, unknownEmail] = attempts;
    expect(wrongPassword?.status).toBe(401);
    // Byte-identical, because splitting them is an email oracle.
    expect(wrongPassword?.data).toEqual(unknownEmail?.data);
  });

  it('WEB-SHARED-032 scopes a share token to its own subtree and 404s on a sibling', async () => {
    const api = client();
    const asVisitor = { headers: { 'X-Share-Token': 'meridian-financials-demo-link' } };

    const resolved = await api.get('/shares/resolve', asVisitor);
    expect(resolved.status).toBe(200);
    expect(resolved.data.rootNodeId).toBe(FINANCIALS);

    // Inside the grant.
    const inside = await api.get(`/nodes/${FINANCIALS}/children`, asVisitor);
    expect(inside.status).toBe(200);

    // A sibling folder the grant does not cover. The reviewer's test.
    const sibling = await api.get(`/nodes/${CORPORATE}`, asVisitor);
    expect(sibling.status).toBe(404);

    // And the parent room, which would reveal the shape around the share.
    const parent = await api.get(`/nodes/${ROOM}`, asVisitor);
    expect(parent.status).toBe(404);

    // Same body as an id that never existed — not "forbidden", not a different
    // message. This is the property the whole 404-not-403 rule rests on.
    const missing = await api.get('/nodes/99999999-0000-4000-8000-000000000000', asVisitor);
    expect(sibling.data).toEqual(missing.data);
  });

  it('WEB-SHARED-033 gives a share visitor breadcrumbs that stop at the share root', async () => {
    const api = client();
    const page = await api.get(`/nodes/${FINANCIALS}/children`, {
      headers: { 'X-Share-Token': 'meridian-financials-demo-link' },
    });

    // "Project Meridian" is the parent and must not appear.
    expect(page.data.breadcrumbs.map((crumb: { name: string }) => crumb.name)).toEqual([
      '02 Financials',
    ]);
  });

  it('WEB-SHARED-034 treats revoked and expired links exactly like unknown ones', async () => {
    const api = client();
    const responses = await Promise.all(
      ['revoked-corporate-link', 'expired-northwind-link', 'never-existed'].map((token) =>
        api.get('/shares/resolve', { headers: { 'X-Share-Token': token } }),
      ),
    );

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.data).toEqual(responses[0]?.data);
    }
  });

  it('WEB-SHARED-035 resolves a 16-character short code to the same share as the token', async () => {
    const api = client();
    const byToken = await api.get('/shares/resolve', {
      headers: { 'X-Share-Token': 'meridian-financials-demo-link' },
    });
    const byCode = await api.get('/shares/resolve', {
      headers: { 'X-Share-Token': 'H7QK4M2XR9TB5WVN' },
    });

    expect(byCode.status).toBe(200);
    expect(byCode.data).toEqual(byToken.data);
  });

  it('WEB-SHARED-036 persists mutations for the session and resolves name conflicts', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    const first = await api.post('/nodes/folders', { parentId: ROOM, name: 'Diligence' }, auth);
    expect(first.status).toBe(201);

    // Same name again: a 409 carrying a name the dialog can offer.
    const conflict = await api.post('/nodes/folders', { parentId: ROOM, name: 'Diligence' }, auth);
    expect(conflict.status).toBe(409);
    expect(conflict.data.code).toBe('NAME_CONFLICT');
    expect(conflict.data.details.suggestedName).toBe('Diligence (1)');

    const listed = await api.get(`/nodes/${ROOM}/children`, auth);
    expect(listed.data.items.map((n: { name: string }) => n.name)).toContain('Diligence');
  });

  it('WEB-SHARED-037 cascades a delete and revokes the grants underneath it', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    // The demo link is on 02 Financials; delete it and the link must die.
    expect((await api.delete(`/nodes/${FINANCIALS}`, auth)).status).toBe(204);

    const resolved = await api.get('/shares/resolve', {
      headers: { 'X-Share-Token': 'meridian-financials-demo-link' },
    });
    expect(resolved.status).toBe(404);

    // The descendant folder went with it rather than being orphaned.
    const descendant = await api.get('/nodes/20000000-0000-4000-8000-000000000003', auth);
    expect(descendant.status).toBe(404);
  });

  it('WEB-SHARED-038 refuses to move a folder beneath its own descendant', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    const response = await api.patch(
      `/nodes/${FINANCIALS}/parent`,
      { parentId: '20000000-0000-4000-8000-000000000003' },
      auth,
    );

    expect(response.status).toBe(400);
    expect(response.data.code).toBe('CYCLIC_MOVE');
  });

  it('WEB-SHARED-039 takes size and type from the uploaded bytes, not from the client claim', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    const init = await api.post(
      '/uploads/init',
      { parentId: ROOM, name: 'New Filing.pdf', sizeBytes: 999, contentType: 'application/pdf' },
      auth,
    );
    expect(init.status).toBe(200);

    // The browser's direct PUT, which never goes through the API.
    const pdf = new TextEncoder().encode('%PDF-1.7\nplaceholder');
    await api.put(init.data.uploadUrl, pdf);

    const complete = await api.post(`/uploads/${init.data.nodeId}/complete`, {}, auth);
    expect(complete.status).toBe(200);
    // 999 was the claim; 20 is the truth.
    expect(complete.data.sizeBytes).toBe(pdf.byteLength);
    expect(complete.data.state).toBe('active');
  });

  it('WEB-SHARED-040 rejects non-PDF bytes even when the client declared a PDF', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    const init = await api.post(
      '/uploads/init',
      { parentId: ROOM, name: 'trojan.pdf', sizeBytes: 30, contentType: 'application/pdf' },
      auth,
    );
    await api.put(init.data.uploadUrl, new TextEncoder().encode('<html><script>alert(1)</script>'));

    const complete = await api.post(`/uploads/${init.data.nodeId}/complete`, {}, auth);
    expect(complete.status).toBe(415);
    expect(complete.data.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('WEB-SHARED-041 pages with an opaque cursor rather than an offset', async () => {
    const api = client();
    const auth = { headers: { Authorization: OWNER } };

    const first = await api.get(`/nodes/${ROOM}/children?limit=2`, auth);
    expect(first.data.items).toHaveLength(2);
    expect(typeof first.data.nextCursor).toBe('string');

    const second = await api.get(
      `/nodes/${ROOM}/children?limit=2&cursor=${encodeURIComponent(first.data.nextCursor)}`,
      auth,
    );

    const firstNames = first.data.items.map((n: { name: string }) => n.name);
    const secondNames = second.data.items.map((n: { name: string }) => n.name);
    expect(secondNames).not.toEqual(firstNames);
    // No row appears twice across the boundary, which is what an offset gets
    // wrong the moment anything is inserted mid-page.
    expect(new Set([...firstNames, ...secondNames]).size).toBe(4);
  });

  it('WEB-SHARED-042 hides soft-deleted fixtures from listings', async () => {
    const api = client();
    const page = await api.get(`/nodes/${FINANCIALS}/children`, {
      headers: { Authorization: OWNER },
    });

    expect(page.data.items.map((n: { name: string }) => n.name)).not.toContain(
      'Superseded Budget.pdf',
    );
  });
});
