import {
  MAX_DEPTH,
  MAX_NAME_LENGTH,
  NodeStateSchema,
  NodeTypeSchema,
  RoleSchema,
  ShareKindSchema,
  type Breadcrumb,
  type NodeDetail,
  type NodeSummary,
} from '@dataroom/shared';
import { z } from 'zod';

import nodeFixtures from './fixtures/nodes.json';
import shareFixtures from './fixtures/shares.json';
import userFixtures from './fixtures/users.json';

/**
 * The in-memory store behind the fake transport.
 *
 * It mirrors the *contract*, not a table: ancestry is computed by walking
 * `parentId`, exactly as `nodes/TODO.md` specifies, and there is no `path`
 * string anywhere. That is deliberate — the storage strategy is still an open
 * decision, and a mock that invented one would teach the UI a shape that may
 * never exist.
 */

/**
 * The internal record shape, which is not the wire shape. Fixtures are parsed
 * through this at load, so a hand-edited JSON with a missing field or a bad
 * uuid fails immediately and names the path, rather than surfacing later as an
 * undefined in a component.
 */
const MockNodeSchema = z.strictObject({
  id: z.uuid(),
  type: NodeTypeSchema,
  rootId: z.uuid(),
  parentId: z.uuid().nullable(),
  ownerId: z.uuid(),
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  depth: z.int().min(0).max(MAX_DEPTH),
  state: NodeStateSchema,
  sizeBytes: z.int().nonnegative().nullable(),
  contentType: z.string().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

const MockShareSchema = z.strictObject({
  id: z.uuid(),
  nodeId: z.uuid(),
  kind: ShareKindSchema,
  role: RoleSchema,
  principalEmail: z.email().nullable(),
  principalUserId: z.uuid().nullable(),
  /** Plaintext here on purpose — a mock has nothing to protect and a demo needs a link it can paste. */
  token: z.string().nullable(),
  shortCode: z.string().length(16).nullable(),
  expiresAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
});

const MockUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  isAdmin: z.boolean(),
  password: z.string().min(1),
});

export type MockNode = z.infer<typeof MockNodeSchema>;
export type MockShare = z.infer<typeof MockShareSchema>;
export type MockUser = z.infer<typeof MockUserSchema>;

export interface MockDb {
  nodes: Map<string, MockNode>;
  shares: Map<string, MockShare>;
  users: Map<string, MockUser>;
  /** Uploaded bytes, keyed by node id. Stands in for the bucket. */
  blobs: Map<string, Uint8Array>;
}

function parseFixtures(): MockDb {
  const nodes = new Map<string, MockNode>();
  const shares = new Map<string, MockShare>();
  const users = new Map<string, MockUser>();

  for (const [index, raw] of userFixtures.entries()) {
    const user = parseOrThrow(MockUserSchema, raw, `users.json[${index}]`);
    users.set(user.id, user);
  }
  for (const [index, raw] of nodeFixtures.entries()) {
    const node = parseOrThrow(MockNodeSchema, raw, `nodes.json[${index}]`);
    nodes.set(node.id, node);
  }
  for (const [index, raw] of shareFixtures.entries()) {
    const share = parseOrThrow(MockShareSchema, raw, `shares.json[${index}]`);
    shares.set(share.id, share);
  }

  assertReferentialIntegrity(nodes, shares, users);
  return { nodes, shares, users, blobs: new Map() };
}

function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown, where: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `    ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Mock fixture ${where} does not match the contract:\n${problems}`);
  }
  return result.data;
}

/**
 * Valid-but-wrong is the other half of a bad fixture. A node pointing at a
 * parent that is not in the file produces an explorer that renders nothing and
 * an error nobody can trace back to a JSON edit.
 */
function assertReferentialIntegrity(
  nodes: Map<string, MockNode>,
  shares: Map<string, MockShare>,
  users: Map<string, MockUser>,
): void {
  const problems: string[] = [];

  for (const node of nodes.values()) {
    if (node.parentId !== null && !nodes.has(node.parentId)) {
      problems.push(`node ${node.name}: parentId ${node.parentId} does not exist`);
    }
    if (!nodes.has(node.rootId)) {
      problems.push(`node ${node.name}: rootId ${node.rootId} does not exist`);
    }
    if (!users.has(node.ownerId)) {
      problems.push(`node ${node.name}: ownerId ${node.ownerId} does not exist`);
    }
    if (node.parentId === null && node.type !== 'room') {
      problems.push(`node ${node.name}: only a room may have no parent`);
    }
    const computed = ancestorIdsOf(nodes, node.id).length;
    if (computed !== node.depth) {
      problems.push(`node ${node.name}: depth is ${node.depth} but its ancestor chain is ${computed}`);
    }
  }

  for (const share of shares.values()) {
    if (!nodes.has(share.nodeId)) {
      problems.push(`share ${share.id}: nodeId ${share.nodeId} does not exist`);
    }
    if (share.kind === 'public_link' && share.token === null) {
      problems.push(`share ${share.id}: a public_link needs a token`);
    }
    if (share.kind === 'user' && share.principalEmail === null) {
      problems.push(`share ${share.id}: a user grant needs a principalEmail`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Mock fixtures are internally inconsistent:\n  ${problems.join('\n  ')}`);
  }
}

let db: MockDb = parseFixtures();

export function mockDb(): MockDb {
  return db;
}

/** Back to the fixtures. For tests, and for a "reset demo" affordance. */
export function resetMockDb(): void {
  db = parseFixtures();
}

// ---------------------------------------------------------------------------
// Ancestry — computed from `parentId`, which is the source of truth
// ---------------------------------------------------------------------------

/** Root first, excluding self. Mirrors `Ancestry.ancestorIds` in the contract. */
export function ancestorIdsOf(nodes: Map<string, MockNode>, id: string): string[] {
  const chain: string[] = [];
  let current = nodes.get(id)?.parentId ?? null;

  // Bounded rather than `while (current)`: a fixture with a cycle would
  // otherwise hang the browser with no clue why.
  for (let hops = 0; current !== null && hops <= MAX_DEPTH + 1; hops += 1) {
    chain.unshift(current);
    current = nodes.get(current)?.parentId ?? null;
  }
  return chain;
}

export function ancestorsDeleted(nodes: Map<string, MockNode>, id: string): boolean {
  return ancestorIdsOf(nodes, id).some((ancestorId) => nodes.get(ancestorId)?.deletedAt !== null);
}

/** Every live descendant, self excluded. Used by cascade delete and by stats. */
export function descendantsOf(nodes: Map<string, MockNode>, id: string): MockNode[] {
  return [...nodes.values()].filter((node) => ancestorIdsOf(nodes, node.id).includes(id));
}

export function isVisible(nodes: Map<string, MockNode>, node: MockNode): boolean {
  return node.deletedAt === null && !ancestorsDeleted(nodes, node.id) && node.state === 'active';
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export function toSummary(nodes: Map<string, MockNode>, node: MockNode): NodeSummary {
  const rollup =
    node.type === 'file'
      ? { subtreeFiles: null, subtreeBytes: null }
      : subtreeRollup(nodes, node.id);

  return {
    id: node.id,
    type: node.type,
    name: node.name,
    state: node.state,
    sizeBytes: node.sizeBytes,
    contentType: node.contentType,
    subtreeFiles: rollup.subtreeFiles,
    subtreeBytes: rollup.subtreeBytes,
    updatedAt: node.updatedAt,
  };
}

export function toDetail(nodes: Map<string, MockNode>, node: MockNode): NodeDetail {
  return {
    ...toSummary(nodes, node),
    rootId: node.rootId,
    parentId: node.parentId,
    depth: node.depth,
    breadcrumbs: breadcrumbsOf(nodes, node.id),
    createdAt: node.createdAt,
  };
}

/**
 * Ancestors as breadcrumbs, self included, root first.
 *
 * `stopAt` exists for the share view: breadcrumbs must stop at the share root
 * and never reveal the ancestors above it, which is a real requirement
 * (`WEB-PUBLICVIEW`) rather than a display preference.
 */
export function breadcrumbsOf(
  nodes: Map<string, MockNode>,
  id: string,
  stopAt?: string,
): Breadcrumb[] {
  const chain = [...ancestorIdsOf(nodes, id), id];
  const from = stopAt === undefined ? 0 : Math.max(chain.indexOf(stopAt), 0);

  return chain.slice(from).flatMap((nodeId) => {
    const node = nodes.get(nodeId);
    return node === undefined ? [] : [{ id: node.id, name: node.name, type: node.type }];
  });
}

export function subtreeRollup(
  nodes: Map<string, MockNode>,
  id: string,
): { subtreeFiles: number; subtreeBytes: number } {
  let subtreeFiles = 0;
  let subtreeBytes = 0;

  for (const node of descendantsOf(nodes, id)) {
    if (node.type !== 'file' || !isVisible(nodes, node)) continue;
    subtreeFiles += 1;
    subtreeBytes += node.sizeBytes ?? 0;
  }
  return { subtreeFiles, subtreeBytes };
}

// ---------------------------------------------------------------------------
// Ordering and pagination
// ---------------------------------------------------------------------------

/**
 * Folders before files, then by name, then by id — the same `ORDER BY` the API
 * specifies. The name comparison is by code point rather than locale, matching
 * `COLLATE "C"`: a locale-aware sort here would page differently from the
 * server and the difference would only appear with non-ASCII names.
 */
export function compareChildren(a: MockNode, b: MockNode): number {
  const rank = (node: MockNode): number => (node.type === 'file' ? 1 : 0);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  // Zero for the same row, and the `id === id` case is not academic: the
  // keyset cursor asks "which rows sort strictly after this position?", so a
  // comparator that reports 1 against an identical row puts the boundary row
  // at the top of the next page. The symptom is one duplicated item per page
  // boundary — invisible on a short list, and exactly what keyset paging is
  // supposed to prevent.
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export interface CursorPosition {
  type: string;
  name: string;
  id: string;
}

export function encodeMockCursor(position: CursorPosition): string {
  // Opaque to the caller, and unsigned — this is a fake, and there is nothing
  // here worth forging. The real one is HMAC-signed; see common/pagination.
  return btoa(JSON.stringify([position.type, position.name, position.id]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function decodeMockCursor(cursor: string): CursorPosition | null {
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const parsed: unknown = JSON.parse(atob(padded));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [type, name, id] = parsed as [string, string, string];
    return { type, name, id };
  } catch {
    return null;
  }
}
