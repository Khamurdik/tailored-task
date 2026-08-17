import {
  CreateShareRequestSchema,
  ResolveShareResponseSchema,
  type CreatedShare,
  type ResolveShareResponse,
  type ShareSummary,
} from '@dataroom/shared';

import { readable, writable } from '../access';
import { ancestorIdsOf, mockDb, type MockShare } from '../db';
import {
  created,
  noContent,
  notFound,
  ok,
  validationFailed,
  type MockRequest,
  type MockResponse,
} from '../http';
import { findLiveShareByCredential, resolveActor } from '../session';
import { validateResponse } from '../validate';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 16 Crockford base32 characters, no I/L/O/U. See `links/TODO.md`. */
function mintShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => CROCKFORD[byte % CROCKFORD.length] ?? '0').join('');
}

function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function toSummary(share: MockShare, inheritedFrom: { id: string; name: string } | null): ShareSummary {
  return {
    id: share.id,
    nodeId: share.nodeId,
    kind: share.kind,
    role: share.role,
    principalEmail: share.principalEmail,
    hasShortCode: share.shortCode !== null,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
    inheritedFrom,
  };
}

/**
 * `GET /nodes/:id/shares` — grants on this node **and** inherited ones,
 * visibly distinguished.
 *
 * The inherited half is the point. An owner asking "why is this exposed?" gets
 * a wrong answer from a list of direct grants, because the grant that exposed
 * it is usually three levels up.
 */
export function listShares(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const db = mockDb();
  const ancestors = ancestorIdsOf(db.nodes, node.id);
  const items: ShareSummary[] = [];

  for (const share of db.shares.values()) {
    if (share.revokedAt !== null) continue;
    if (share.nodeId === node.id) {
      items.push(toSummary(share, null));
    } else if (ancestors.includes(share.nodeId)) {
      const source = db.nodes.get(share.nodeId);
      items.push(toSummary(share, source === undefined ? null : { id: source.id, name: source.name }));
    }
  }

  return ok({ items, nextCursor: null });
}

export function createShare(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const parsed = CreateShareRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return validationFailed('A share needs a kind, and a user grant needs an email');
  }

  const share: MockShare = {
    id: crypto.randomUUID(),
    nodeId: node.id,
    kind: parsed.data.kind,
    role: parsed.data.role,
    principalEmail: parsed.data.email ?? null,
    principalUserId:
      [...mockDb().users.values()].find(
        (user) => user.email.toLowerCase() === parsed.data.email?.toLowerCase(),
      )?.id ?? null,
    token: parsed.data.kind === 'public_link' ? mintToken() : null,
    // Opt-in, because a grant is only as strong as its weakest credential.
    shortCode: parsed.data.kind === 'public_link' && parsed.data.shortLink ? mintShortCode() : null,
    expiresAt: parsed.data.expiresAt,
    revokedAt: null,
    createdBy: actor?.kind === 'user' ? actor.user.id : node.ownerId,
    createdAt: new Date().toISOString(),
  };

  mockDb().shares.set(share.id, share);

  // The plaintext appears in exactly this one response and is never readable
  // again — the same rule as the real API, so the "copy it now" affordance in
  // the share dialog is built against a credential it genuinely cannot re-fetch.
  const body: CreatedShare = {
    share: toSummary(share, null),
    // Null, not `''`, for a user grant — the real API cannot return a token
    // there because the database refuses to store one. See `CreatedShareSchema`.
    token: share.token,
    shortCode: share.shortCode,
  };
  return created(body);
}

export function revokeShare(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  if (actor?.kind !== 'user') return notFound();

  const share = mockDb().shares.get(request.params['id'] ?? '');
  if (share === undefined) return notFound();

  const node = writable(actor, share.nodeId);
  if (node === null) return notFound();

  share.revokedAt = new Date().toISOString();
  return noContent();
}

/**
 * `GET /shares/resolve` — the anonymous edge.
 *
 * Every way of failing returns the identical body: unknown, revoked, expired,
 * and pointing at a deleted node are indistinguishable, which is the API half
 * of the one-failure-screen decision. A mock that distinguished them would let
 * `public-view` be built with four screens that the real API can never
 * populate.
 *
 * The response carries no node summary — `public-view` fetches the node
 * separately with the same header, so every fact it learns about the tree has
 * been through the same read check.
 */
export function resolveShare(request: MockRequest): MockResponse {
  const credential = request.headers['x-share-token'] ?? '';
  if (credential === '') return notFound();

  const share = findLiveShareByCredential(credential);
  if (share === null) return notFound();

  // Deleted target, or a deleted ancestor, resolves the same way as a bad
  // token. Checked through the ordinary read path so there is one rule.
  const node = readable({ kind: 'share', share }, share.nodeId);
  if (node === null) return notFound();

  const body: ResolveShareResponse = {
    rootNodeId: share.nodeId,
    role: share.role,
    expiresAt: share.expiresAt,
  };
  return ok(validateResponse(ResolveShareResponseSchema, body, 'GET /shares/resolve'));
}
