import {
  ChildrenPageSchema,
  CreateFolderRequestSchema,
  CreateRoomRequestSchema,
  MoveNodeRequestSchema,
  NodeDetailSchema,
  MAX_DEPTH,
  MAX_NAME_LENGTH,
  PAGE_SIZE,
  RenameNodeRequestSchema,
  type ChildrenPage,
} from '@dataroom/shared';

import { readable, writable } from '../access';
import {
  ancestorIdsOf,
  breadcrumbsOf,
  compareChildren,
  decodeMockCursor,
  descendantsOf,
  encodeMockCursor,
  isVisible,
  mockDb,
  subtreeRollup,
  toDetail,
  toSummary,
  type MockNode,
} from '../db';
import {
  created,
  fail,
  nameConflict,
  noContent,
  notFound,
  ok,
  validationFailed,
  type MockRequest,
  type MockResponse,
} from '../http';
import { resolveActor } from '../session';
import { validateResponse } from '../validate';

/**
 * Names are normalised the same way the API normalises them, because the
 * conflict rules depend on it: `café` composed and decomposed must collide, and
 * a mock that skips NFC makes them look like two perfectly good names.
 */
function normalize(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function siblingsOf(parentId: string): MockNode[] {
  const nodes = mockDb().nodes;
  return [...nodes.values()].filter((node) => node.parentId === parentId && isVisible(nodes, node));
}

function suggestName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;

  const dot = name.lastIndexOf('.');
  const hasExtension = dot > 0 && dot < name.length - 1;
  const stem = hasExtension ? name.slice(0, dot) : name;
  const extension = hasExtension ? name.slice(dot) : '';
  const existing = /^(.*?)\s\((\d+)\)$/.exec(stem);
  const base = existing?.[1] ?? stem;
  const start = existing?.[2] === undefined ? 1 : Number(existing[2]) + 1;

  for (let n = start; n < start + 1000; n += 1) {
    const suffix = ` (${n})`;
    const room = MAX_NAME_LENGTH - suffix.length - extension.length;
    const candidate = `${base.length > room ? base.slice(0, room).trimEnd() : base}${suffix}${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${extension}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------

/** `GET /nodes` — the room list. Rooms only; the explorer pages within one. */
export function listRooms(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  if (actor?.kind !== 'user') return notFound();

  const nodes = mockDb().nodes;
  const rooms = [...nodes.values()]
    .filter((node) => node.type === 'room' && isVisible(nodes, node) && node.ownerId === actor.user.id)
    .sort(compareChildren)
    .map((node) => toSummary(nodes, node));

  return ok({ items: rooms, nextCursor: null, breadcrumbs: [] } satisfies ChildrenPage);
}

/**
 * `GET /nodes/:id/children` — keyset paginated, folders before files.
 *
 * The cursor is opaque and carries the sort position, not an offset. That
 * matters for more than fidelity: an offset-paged mock hides the bug where a
 * row inserted during paging shifts the window, and the explorer would be
 * built without noticing.
 */
export function listChildren(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const parentId = request.params['id'] ?? '';
  const parent = readable(actor, parentId);
  if (parent === null) return notFound();

  const nodes = mockDb().nodes;
  const all = siblingsOf(parent.id).sort(compareChildren);

  const rawCursor = request.query.get('cursor');
  let start = 0;
  if (rawCursor !== null) {
    const position = decodeMockCursor(rawCursor);
    if (position === null) return validationFailed('Malformed cursor');
    start = all.findIndex(
      (node) =>
        compareChildren(node, {
          ...node,
          type: position.type as MockNode['type'],
          name: position.name,
          id: position.id,
        }) > 0,
    );
    if (start < 0) start = all.length;
  }

  const limit = Math.min(Number(request.query.get('limit') ?? PAGE_SIZE) || PAGE_SIZE, PAGE_SIZE);
  const page = all.slice(start, start + limit);
  const last = page.at(-1);
  const more = start + limit < all.length;

  // A share view's breadcrumbs stop at the share root — never revealing the
  // ancestors above it, which would leak the shape of the room around the part
  // that was actually shared.
  const stopAt = actor?.kind === 'share' ? actor.share.nodeId : undefined;

  const body: ChildrenPage = {
    items: page.map((node) => toSummary(nodes, node)),
    nextCursor:
      more && last !== undefined
        ? encodeMockCursor({ type: last.type, name: last.name, id: last.id })
        : null,
    breadcrumbs: breadcrumbsOf(nodes, parent.id, stopAt),
  };

  return ok(validateResponse(ChildrenPageSchema, body, 'GET /nodes/:id/children'));
}

export function getNode(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = readable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const stopAt = actor?.kind === 'share' ? actor.share.nodeId : undefined;
  const detail = { ...toDetail(mockDb().nodes, node), breadcrumbs: breadcrumbsOf(mockDb().nodes, node.id, stopAt) };

  return ok(validateResponse(NodeDetailSchema, detail, 'GET /nodes/:id'));
}

export function getStats(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = readable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const nodes = mockDb().nodes;
  const rollup = subtreeRollup(nodes, node.id);
  const folders = descendantsOf(nodes, node.id).filter(
    (child) => child.type === 'folder' && isVisible(nodes, child),
  ).length;

  return ok({ files: rollup.subtreeFiles, folders, bytes: rollup.subtreeBytes });
}

export function createRoom(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  if (actor?.kind !== 'user') return notFound();

  const parsed = CreateRoomRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed('A room needs a name');

  const nodes = mockDb().nodes;
  const name = normalize(parsed.data.name);
  const taken = new Set(
    [...nodes.values()]
      .filter((node) => node.type === 'room' && isVisible(nodes, node))
      .map((node) => node.name),
  );
  if (taken.has(name)) return nameConflict(suggestName(name, taken));

  const id = newId();
  const room: MockNode = {
    id,
    type: 'room',
    rootId: id,
    parentId: null,
    ownerId: actor.user.id,
    name,
    depth: 0,
    state: 'active',
    sizeBytes: null,
    contentType: null,
    deletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  nodes.set(id, room);

  return created(toDetail(nodes, room));
}

export function createFolder(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const parsed = CreateFolderRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed('A folder needs a parent and a name');

  const parent = writable(actor, parsed.data.parentId);
  if (parent === null || parent.type === 'file') return notFound();

  const nodes = mockDb().nodes;
  const name = normalize(parsed.data.name);
  const taken = new Set(siblingsOf(parent.id).map((node) => node.name));
  if (taken.has(name)) return nameConflict(suggestName(name, taken));

  if (parent.depth + 1 > MAX_DEPTH) {
    return fail(400, 'DEPTH_LIMIT', `The tree may not exceed ${MAX_DEPTH} levels`, {
      max: MAX_DEPTH,
    });
  }

  const folder: MockNode = {
    id: newId(),
    type: 'folder',
    rootId: parent.rootId,
    parentId: parent.id,
    ownerId: parent.ownerId,
    name,
    depth: parent.depth + 1,
    state: 'active',
    sizeBytes: null,
    contentType: null,
    deletedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  nodes.set(folder.id, folder);

  return created(toDetail(nodes, folder));
}

export function renameNode(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const parsed = RenameNodeRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed('A name is required');

  const nodes = mockDb().nodes;
  const name = normalize(parsed.data.name);
  const taken = new Set(
    (node.parentId === null
      ? [...nodes.values()].filter((other) => other.type === 'room' && isVisible(nodes, other))
      : siblingsOf(node.parentId)
    )
      .filter((other) => other.id !== node.id)
      .map((other) => other.name),
  );
  if (taken.has(name)) return nameConflict(suggestName(name, taken));

  node.name = name;
  node.updatedAt = nowIso();
  return ok(toDetail(nodes, node));
}

/**
 * Move, with the two rejections that actually matter.
 *
 * `CYCLIC_MOVE` is the one that looks legal from the parent's side and silently
 * detaches a subtree; `DEPTH_LIMIT` accounts for the height of what is being
 * moved, not just the destination, because moving a five-deep folder near the
 * cap is how the limit is really reached.
 */
export function moveNode(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const parsed = MoveNodeRequestSchema.safeParse(request.body);
  if (!parsed.success) return validationFailed('A destination is required');

  const destination = writable(actor, parsed.data.parentId);
  if (destination === null || destination.type === 'file') return notFound();

  const nodes = mockDb().nodes;
  if (destination.id === node.id || ancestorIdsOf(nodes, destination.id).includes(node.id)) {
    return fail(400, 'CYCLIC_MOVE', 'A node cannot be moved beneath its own descendant');
  }

  const subtree = descendantsOf(nodes, node.id);
  const height = subtree.reduce((tallest, child) => Math.max(tallest, child.depth - node.depth), 0);
  if (destination.depth + 1 + height > MAX_DEPTH) {
    return fail(400, 'DEPTH_LIMIT', `The tree may not exceed ${MAX_DEPTH} levels`, {
      max: MAX_DEPTH,
    });
  }

  const taken = new Set(siblingsOf(destination.id).map((other) => other.name));
  if (taken.has(node.name)) return nameConflict(suggestName(node.name, taken));

  const delta = destination.depth + 1 - node.depth;
  node.parentId = destination.id;
  node.rootId = destination.rootId;
  node.depth += delta;
  node.updatedAt = nowIso();
  for (const child of subtree) {
    child.depth += delta;
    child.rootId = destination.rootId;
    child.updatedAt = nowIso();
  }

  return ok(toDetail(nodes, node));
}

/**
 * Soft delete, cascading to every descendant, and revoking grants underneath.
 *
 * Both halves are here because both are observable from the front end: a
 * cascade that misses descendants leaves rows the explorer still renders, and
 * a grant that survives means a revoked share keeps working in the demo.
 */
export function deleteNode(request: MockRequest): MockResponse {
  const actor = resolveActor(request);
  const node = writable(actor, request.params['id'] ?? '');
  if (node === null) return notFound();

  const db = mockDb();
  const at = nowIso();
  const affected = [node, ...descendantsOf(db.nodes, node.id)];

  for (const target of affected) {
    if (target.deletedAt === null) target.deletedAt = at;
    target.updatedAt = at;
  }

  const affectedIds = new Set(affected.map((target) => target.id));
  for (const share of db.shares.values()) {
    if (affectedIds.has(share.nodeId) && share.revokedAt === null) share.revokedAt = at;
  }

  return noContent();
}
