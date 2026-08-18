import { randomUUID } from 'node:crypto';

import type { PrismaService } from '@api/common';

/**
 * Realistic defaults, including **non-ASCII names by default**.
 *
 * That is deliberate. Unicode handling is a first-class correctness concern here
 * — NFC normalization before uniqueness, `COLLATE "C"` matching the cursor — and
 * a factory that produces `folder-1` moves every one of those bugs into a single
 * dedicated test that everyone remembers to skip. Making the ordinary case
 * non-ASCII means they surface in whatever test happens to run.
 */
const NAMES = [
  'Звіт',
  'café',
  'Ärendehandlingar',
  '契約書',
  'Bilan financier',
  'Đầu tư',
  'straße',
];

let counter = 0;

/** Unique per call, so a factory used twice in one test does not collide. */
function uniqueName(prefix?: string): string {
  counter += 1;
  const base = NAMES[counter % NAMES.length] ?? 'folder';
  return `${prefix ?? base} ${counter}`;
}

export async function makeUser(
  prisma: PrismaService,
  overrides: { email?: string; name?: string; isAdmin?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = overrides.email ?? `user-${id.slice(0, 8)}@example.com`;

  await prisma.user.create({
    data: {
      id,
      email,
      name: overrides.name ?? 'Test User',
      isAdmin: overrides.isAdmin ?? false,
      // No password. These users never log in; `auth` has its own fixtures, and
      // hashing one here would make every factory call pay for argon2.
      passwordHash: null,
    },
  });

  return { id, email };
}

/**
 * Inserts a node **through the repository**, not through raw SQL.
 *
 * The rule from `tests/TODO.md` §6: a test that writes an impossible row proves
 * nothing about the system. Going through the same code the application uses
 * means a factory cannot create a tree the application could not have.
 */
export interface TreeFactories {
  room: (name?: string) => Promise<string>;
  folder: (parentId: string, name?: string) => Promise<string>;
  file: (parentId: string, name?: string) => Promise<string>;
}

export function treeFactories(
  nodes: {
    createRoom: (ownerId: string, name: string) => Promise<{ id: string }>;
    createFolder: (parentId: string, name: string) => Promise<{ id: string }>;
  },
  ownerId: string,
): TreeFactories {
  return {
    room: async (name) => (await nodes.createRoom(ownerId, name ?? uniqueName('Room'))).id,
    folder: async (parentId, name) =>
      (await nodes.createFolder(parentId, name ?? uniqueName())).id,
    // A file is created by `files` in production, via the upload lifecycle.
    // Until that module exists, a folder stands in for tree-shape tests — the
    // property test cares about ancestry, which does not depend on type.
    file: async (parentId, name) => (await nodes.createFolder(parentId, name ?? uniqueName())).id,
  };
}

export { uniqueName };
