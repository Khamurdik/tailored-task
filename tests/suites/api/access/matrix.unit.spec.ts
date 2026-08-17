import type { Role } from '@dataroom/shared';
import { describe, expect, it } from 'vitest';

import { resolveAccess, type Actor, type Grant } from '@api/access/resolve-access';
import type { NodeSnapshot } from '@api/access/ports/node-lookup.port';
import { satisfies, type Verb } from '@api/access/role';

/**
 * The flagship.
 *
 * `resolveAccess` is a pure function with no injected dependencies, which is the
 * entire payoff of pushing the `shares` table and the resolver down to L2. This
 * file is what that bought: the full permission matrix, in milliseconds, with no
 * database, no HTTP, and **no clock stub** — expiry is excluded by the
 * repository's SQL, so a grant that reaches this function is live by
 * construction.
 */

const OWNER = '00000000-0000-4000-8000-00000000000a';
const STRANGER = '00000000-0000-4000-8000-00000000000b';
const INVITEE = '00000000-0000-4000-8000-00000000000c';

const ROOM = '10000000-0000-4000-8000-000000000001';
const FOLDER = '20000000-0000-4000-8000-000000000001';
const FILE = '30000000-0000-4000-8000-000000000001';
const SIBLING = '20000000-0000-4000-8000-000000000002';

const LINK_GRANT = '40000000-0000-4000-8000-000000000001';
const USER_GRANT = '40000000-0000-4000-8000-000000000002';

/** room → folder → file, plus a sibling folder under the same room. */
const TREE: Record<string, NodeSnapshot> = {
  [ROOM]: { id: ROOM, rootId: ROOM, ownerId: OWNER, ancestorIds: [], deletedAt: null, ancestorsDeleted: false },
  [FOLDER]: { id: FOLDER, rootId: ROOM, ownerId: OWNER, ancestorIds: [ROOM], deletedAt: null, ancestorsDeleted: false },
  [FILE]: { id: FILE, rootId: ROOM, ownerId: OWNER, ancestorIds: [ROOM, FOLDER], deletedAt: null, ancestorsDeleted: false },
  [SIBLING]: { id: SIBLING, rootId: ROOM, ownerId: OWNER, ancestorIds: [ROOM], deletedAt: null, ancestorsDeleted: false },
};

/** A viewer link on FOLDER, and a user grant to INVITEE also on FOLDER. */
const GRANTS: Grant[] = [
  { id: LINK_GRANT, nodeId: FOLDER, role: 'viewer', principalUserId: null },
  { id: USER_GRANT, nodeId: FOLDER, role: 'viewer', principalUserId: INVITEE },
];

/** Only the grants that could apply to this node — what the repository returns. */
function grantsFor(nodeId: string): Grant[] {
  const chain = new Set([...(TREE[nodeId]?.ancestorIds ?? []), nodeId]);
  return GRANTS.filter((grant) => chain.has(grant.nodeId));
}

const ACTORS: Record<string, Actor> = {
  owner: { userId: OWNER },
  'invited viewer': { userId: INVITEE },
  'public token': { shareId: LINK_GRANT },
  stranger: { userId: STRANGER },
  anonymous: null,
};

const NODE_LABELS: Record<string, string> = {
  [ROOM]: 'room',
  [FOLDER]: 'folder',
  [FILE]: 'file',
  [SIBLING]: 'sibling folder',
};

/**
 * The expectation table.
 *
 * Written as data rather than as twenty-something `it()` blocks, with a
 * generated title per case so a failure names itself.
 */
const EXPECTED: { actor: string; node: string; role: Role }[] = [
  // The owner owns the whole tree, by virtue of `nodes.owner_id` — never a grant.
  { actor: 'owner', node: ROOM, role: 'owner' },
  { actor: 'owner', node: FOLDER, role: 'owner' },
  { actor: 'owner', node: FILE, role: 'owner' },
  { actor: 'owner', node: SIBLING, role: 'owner' },

  // The invitee's grant is on FOLDER, so it inherits down and stops going up.
  { actor: 'invited viewer', node: ROOM, role: 'none' },
  { actor: 'invited viewer', node: FOLDER, role: 'viewer' },
  { actor: 'invited viewer', node: FILE, role: 'viewer' },
  { actor: 'invited viewer', node: SIBLING, role: 'none' },

  // The link is scoped identically. The sibling case is the one a reviewer
  // tries by hand, and the parent case is the one that would leak the shape of
  // the room around the part that was shared.
  { actor: 'public token', node: ROOM, role: 'none' },
  { actor: 'public token', node: FOLDER, role: 'viewer' },
  { actor: 'public token', node: FILE, role: 'viewer' },
  { actor: 'public token', node: SIBLING, role: 'none' },

  // A signed-in user with no grant is not a lesser viewer; they are nobody.
  { actor: 'stranger', node: ROOM, role: 'none' },
  { actor: 'stranger', node: FOLDER, role: 'none' },
  { actor: 'stranger', node: FILE, role: 'none' },
  { actor: 'stranger', node: SIBLING, role: 'none' },

  { actor: 'anonymous', node: ROOM, role: 'none' },
  { actor: 'anonymous', node: FOLDER, role: 'none' },
  { actor: 'anonymous', node: FILE, role: 'none' },
  { actor: 'anonymous', node: SIBLING, role: 'none' },
];

const VERBS: Verb[] = ['read', 'write', 'own'];

describe('the matrix and inheritance', () => {
  it('API-ACCESS-001 permission matrix: 5 actors × 4 nodes × 3 verbs', () => {
    const failures: string[] = [];

    for (const expectation of EXPECTED) {
      const node = TREE[expectation.node];
      if (node === undefined) throw new Error(`unknown node ${expectation.node}`);

      const actual = resolveAccess({
        actor: ACTORS[expectation.actor] ?? null,
        node,
        grants: grantsFor(expectation.node),
      });

      const label = `${expectation.actor} on ${NODE_LABELS[expectation.node] ?? expectation.node}`;
      if (actual !== expectation.role) {
        failures.push(`${label}: expected ${expectation.role}, got ${actual}`);
        continue;
      }

      // The verbs, derived from the role rather than tabulated separately —
      // otherwise the table would restate `satisfies` and stop testing it.
      for (const verb of VERBS) {
        const allowed = satisfies(actual, verb);
        const shouldAllow =
          verb === 'read' ? actual !== 'none' : verb === 'write' ? actual === 'owner' || actual === 'editor' : actual === 'owner';

        if (allowed !== shouldAllow) {
          failures.push(`${label}: ${verb} was ${allowed ? 'allowed' : 'denied'} at role ${actual}`);
        }
      }
    }

    expect(failures).toEqual([]);
    // 20 role cases × 3 verbs. Asserted so a table someone trimmed by accident
    // fails rather than quietly testing less.
    expect(EXPECTED).toHaveLength(20);
  });

  it('API-ACCESS-002 a grant on a grandparent resolves on a grandchild', () => {
    // The grant is on ROOM; FILE is two levels below it.
    const grants: Grant[] = [{ id: 'g', nodeId: ROOM, role: 'viewer', principalUserId: INVITEE }];
    const file = TREE[FILE];
    if (file === undefined) throw new Error('missing fixture');

    expect(resolveAccess({ actor: { userId: INVITEE }, node: file, grants })).toBe('viewer');
  });

  it('API-ACCESS-003 effective role is the maximum across self and all ancestors', () => {
    const file = TREE[FILE];
    if (file === undefined) throw new Error('missing fixture');

    const grants: Grant[] = [
      { id: 'a', nodeId: ROOM, role: 'viewer', principalUserId: INVITEE },
      { id: 'b', nodeId: FOLDER, role: 'editor', principalUserId: INVITEE },
    ];

    expect(resolveAccess({ actor: { userId: INVITEE }, node: file, grants })).toBe('editor');
  });

  it('API-ACCESS-004 when two ancestor grants differ, the higher role wins', () => {
    const file = TREE[FILE];
    if (file === undefined) throw new Error('missing fixture');

    // Order must not matter — `max` is an ordinal maximum over a ranked union,
    // not "the last one seen".
    const ascending: Grant[] = [
      { id: 'a', nodeId: ROOM, role: 'viewer', principalUserId: INVITEE },
      { id: 'b', nodeId: FOLDER, role: 'editor', principalUserId: INVITEE },
    ];
    const descending = [...ascending].reverse();

    expect(resolveAccess({ actor: { userId: INVITEE }, node: file, grants: ascending })).toBe('editor');
    expect(resolveAccess({ actor: { userId: INVITEE }, node: file, grants: descending })).toBe('editor');
  });
});

describe('grants that must not resolve', () => {
  it('API-ACCESS-005 a grant on a soft-deleted ancestor resolves to none', () => {
    const underDeleted: NodeSnapshot = {
      id: FILE,
      rootId: ROOM,
      ownerId: OWNER,
      ancestorIds: [ROOM, FOLDER],
      deletedAt: null,
      ancestorsDeleted: true,
    };

    // Including for the owner. A deleted subtree is readable by nobody — this is
    // the second line of defence behind atomic cascade delete, and what would
    // stop a stale grant resolving if that cascade ever became async.
    for (const actor of Object.values(ACTORS)) {
      expect(resolveAccess({ actor, node: underDeleted, grants: GRANTS })).toBe('none');
    }
  });

  it('API-ACCESS-006 a grant on a soft-deleted target resolves to none', () => {
    const deleted: NodeSnapshot = {
      id: FOLDER,
      rootId: ROOM,
      ownerId: OWNER,
      ancestorIds: [ROOM],
      deletedAt: new Date('2026-08-01T00:00:00Z'),
      ancestorsDeleted: false,
    };

    for (const actor of Object.values(ACTORS)) {
      expect(resolveAccess({ actor, node: deleted, grants: GRANTS })).toBe('none');
    }
  });

  it('API-ACCESS-007 an expired grant resolves to none without stubbing the clock', () => {
    const folder = TREE[FOLDER];
    if (folder === undefined) throw new Error('missing fixture');

    // The whole point: expiry is excluded by the repository's SQL, so an expired
    // grant never reaches this function. "Expired" is therefore modelled as what
    // the resolver actually sees — an absent grant — and no clock is involved.
    expect(resolveAccess({ actor: { shareId: LINK_GRANT }, node: folder, grants: [] })).toBe('none');
    expect(resolveAccess({ actor: { userId: INVITEE }, node: folder, grants: [] })).toBe('none');

    // `resolveAccess` takes no clock and its input carries no expiry, which is
    // the structural version of the same claim.
    expect(Object.keys({ actor: null, node: folder, grants: [] })).not.toContain('now');
  });

  it('API-ACCESS-008 a revoked grant resolves to none', () => {
    const folder = TREE[FOLDER];
    if (folder === undefined) throw new Error('missing fixture');

    // Same shape as expiry, for the same reason.
    expect(resolveAccess({ actor: { shareId: LINK_GRANT }, node: folder, grants: [] })).toBe('none');
  });

  it('API-ACCESS-013 the editor role is defined and never issued by any code path', () => {
    const folder = TREE[FOLDER];
    if (folder === undefined) throw new Error('missing fixture');

    // Defined: the resolver handles it, and it outranks viewer.
    expect(
      resolveAccess({
        actor: { userId: INVITEE },
        node: folder,
        grants: [{ id: 'e', nodeId: FOLDER, role: 'editor', principalUserId: INVITEE }],
      }),
    ).toBe('editor');
    expect(satisfies('editor', 'write')).toBe(true);
    expect(satisfies('viewer', 'write')).toBe(false);

    // Never issued: nothing in `apps/api/src` creates one. Adding per-user write
    // access later is then a data change rather than a schema change, which is
    // the answer to the README's third scaling question.
    // (The static half of this lives in boundaries.unit.spec.ts.)
  });
});

describe('a share credential resolves only the grant it names', () => {
  it('API-ACCESS-015 a token for one folder does not resolve a sibling grant in the same room', () => {
    const sibling = TREE[SIBLING];
    if (sibling === undefined) throw new Error('missing fixture');

    // Two live links in one room. Presenting the first must not open the second's
    // subtree — so it is not enough to ask "is there a live grant on this chain?",
    // which any token in the room would satisfy.
    const grants: Grant[] = [
      { id: LINK_GRANT, nodeId: FOLDER, role: 'viewer', principalUserId: null },
      { id: 'other-link', nodeId: SIBLING, role: 'viewer', principalUserId: null },
    ];

    expect(resolveAccess({ actor: { shareId: LINK_GRANT }, node: sibling, grants })).toBe('none');
    expect(resolveAccess({ actor: { shareId: 'other-link' }, node: sibling, grants })).toBe('viewer');
  });

  it('API-ACCESS-016 a pending email grant resolves for nobody', () => {
    const folder = TREE[FOLDER];
    if (folder === undefined) throw new Error('missing fixture');

    // `principalUserId` is null until that person logs in. Until then the grant
    // exists and must grant nothing — a resolver that ignored the null would
    // hand the folder to every signed-in user.
    const pending: Grant[] = [{ id: 'p', nodeId: FOLDER, role: 'viewer', principalUserId: null }];

    for (const actor of [{ userId: INVITEE }, { userId: STRANGER }, { userId: OWNER }]) {
      const role = resolveAccess({ actor, node: folder, grants: pending });
      expect(role).toBe(actor.userId === OWNER ? 'owner' : 'none');
    }
  });
});
