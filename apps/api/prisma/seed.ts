/**
 * `prisma db seed` — the only thing in this system that creates a user, and the
 * only thing that creates the demo room.
 *
 * ## The strip-safe zone
 *
 * Node 26 runs this file directly under **type stripping**: annotations are
 * erased and the result executes, with no compiler. Four things fail there, all
 * verified by execution on 26.7.0, and the whole transitive import graph of
 * this file is subject to all four:
 *
 *   | decorator (`@Injectable()`)                | SyntaxError at the `@`             |
 *   | parameter property (`constructor(private x)`) | ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX |
 *   | `enum`                                     | ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX  |
 *   | extensionless relative import              | ERR_MODULE_NOT_FOUND               |
 *
 * The last one is the sharp one. `apps/api` compiles under
 * `moduleResolution: node10`, so every import in `src/` is extensionless —
 * exactly what Node's ESM resolver rejects — and `.ts` specifiers cannot simply
 * be added there, because `allowImportingTsExtensions` requires `noEmit` and
 * that package emits. So this file is the **only** one in the package that
 * writes `.ts` in a specifier, it is excluded from `tsconfig.json`, and
 * `tsconfig.seed.json` typechecks it separately.
 *
 * The zone is four named leaf modules and this file. Do not widen it casually:
 * every module added is a module that can never use constructor injection. The
 * two added for the demo room were both already in that position and neither
 * imports anything relative:
 *
 *   - `nodes/node-path.ts` — deliberately pure, with no database and no Nest,
 *     and **the only file in the system that understands the path format.**
 *     Importing it is strictly better than the alternative, which is a seeder
 *     that builds `/id/id/id` itself and becomes a second definition of the one
 *     format `nodes` reserves to itself;
 *   - `prisma/demo-tree.ts` — data, no behaviour, no imports at all.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/auth/password.ts';
import { parseSeedUsers } from '../src/common/config/seed-users.schema.ts';
import { buildPath } from '../src/nodes/node-path.ts';
import {
  CROCKFORD_ALPHABET,
  DEMO_NODES,
  DEMO_SHARES,
  SHORT_CODE_LENGTH,
  type DemoNode,
  type DemoShare,
} from './demo-tree.ts';

type Outcome = 'created' | 'updated' | 'password reset' | 'unchanged';

async function main(): Promise<void> {
  const users = parseSeedUsers(process.env.SEED_USERS);
  const forceReset = process.env.SEED_FORCE_RESET === 'true';

  const prisma = new PrismaClient();

  try {
    if (users.length === 0) {
      console.log('SEED_USERS is empty — no accounts to provision.');
    } else {
      for (const user of users) {
        const outcome = await upsert(prisma, user, forceReset);
        // The email, and what happened to it. Never the password and never the
        // hash — this output goes to CI logs and to a terminal someone may be
        // sharing.
        console.log(`  ${user.email.padEnd(32)} ${outcome}`);
      }
      console.log(`Seeded ${users.length} user(s).`);
    }

    await seedDemoTree(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Idempotent upsert by email.
 *
 * Re-running the seed must be safe, because that is the intended way to add a
 * user to a running environment. The rule that makes it safe is the one below:
 * **an existing `password_hash` is never overwritten** unless the operator asks
 * for it explicitly. Without that, a routine re-seed after a deploy silently
 * reverts every password change anyone has made.
 */
async function upsert(
  prisma: PrismaClient,
  user: { email: string; password: string; name: string; admin: boolean },
  forceReset: boolean,
): Promise<Outcome> {
  // NFC before comparison. `citext` folds case, not Unicode composition, so
  // two spellings of the same accented address would otherwise be two rows.
  const email = user.email.normalize('NFC').trim();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing === null) {
    await prisma.user.create({
      data: {
        email,
        name: user.name,
        passwordHash: await hashPassword(user.password),
        isAdmin: user.admin,
      },
    });
    return 'created';
  }

  if (forceReset) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await hashPassword(user.password), name: user.name },
    });
    return 'password reset';
  }

  // `is_admin` is only ever *granted* here, never revoked, and never silently:
  // re-seeding a user who is already an admin without `admin: true` in the
  // JSON leaves them an admin. Demotion is a deliberate act against the
  // database, not a side effect of an edited env var.
  const needsName = existing.name !== user.name;
  const needsAdmin = user.admin && !existing.isAdmin;
  const needsPassword = existing.passwordHash === null;

  if (!needsName && !needsAdmin && !needsPassword) return 'unchanged';

  await prisma.user.update({
    where: { id: existing.id },
    data: {
      ...(needsName ? { name: user.name } : {}),
      ...(needsAdmin ? { isAdmin: true } : {}),
      // Only when there is no password at all — a Google-only account being
      // given one. This is not a reset; there is nothing to overwrite.
      ...(needsPassword ? { passwordHash: await hashPassword(user.password) } : {}),
    },
  });

  return 'updated';
}

/**
 * Where a node ended up. The four fields a *child* needs from its parent, and
 * the reason the walk is one pass over an ordered fixture rather than a
 * recursive build: `root_id`, `owner_id`, `path` and `depth` are all inherited,
 * so a parent that is already on record settles all four for everything under
 * it.
 */
interface Placed {
  id: string;
  rootId: string;
  ownerId: string;
  path: string;
  depth: number;
}

/**
 * Provisions the demo room described in `REVIEW.md` and `HANDOFF-DEMO-DATA.md`.
 *
 * ## Why this runs unconditionally, and what actually gates it
 *
 * There is no `SEED_DEMO` flag. The gate is the fixture's **owners**: every node
 * below hangs off a room owned by a named `example.com` account, so a
 * deployment whose `SEED_USERS` does not contain those identities gets a skip
 * line and no rows. A flag would be a second switch saying the same thing, and
 * the failure mode of two switches is the one where they disagree — a
 * `SEED_DEMO=true` against a database with no Ana, failing on a foreign key.
 *
 * ## What "idempotent" means here
 *
 * The same thing it means for users: **create what is missing, never overwrite
 * what is there.** Every id is fixed, so a second run finds its own rows and
 * leaves them alone — including rows a reviewer has since renamed, moved or
 * deleted. That is deliberate. Re-seeding is how you fix a half-built demo, and
 * a re-seed that reverted a rename would also silently undo whatever someone was
 * in the middle of demonstrating.
 *
 * The one thing it cannot repair is a *hard*-deleted node whose name has since
 * been taken by a live sibling: the row is recreated and
 * `nodes_sibling_name_unique` rejects it. That surfaces as a Prisma `P2002` and
 * is left to surface, because the fix is a decision about someone else's data.
 */
async function seedDemoTree(prisma: PrismaClient): Promise<void> {
  const owners = await resolveOwners(prisma);
  if (owners === null) return;

  const placed = new Map<string, Placed>();

  for (const node of DEMO_NODES) {
    const { where, outcome } = await placeNode(prisma, node, placed, owners);
    placed.set(node.key, where);
    console.log(`  ${node.name.padEnd(32)} ${outcome}`);
  }

  for (const share of DEMO_SHARES) {
    console.log(`  ${describeShare(share).padEnd(32)} ${await placeShare(prisma, share, placed)}`);
  }

  console.log(
    `Seeded the demo room: ${DEMO_NODES.length} node(s), ${DEMO_SHARES.length} grant(s).`,
  );
}

/**
 * The demo room's owners, or null when any of them is missing.
 *
 * Null skips the whole tree rather than the rooms that happen to be owned by
 * someone present. A half-provisioned demo is worse than none: the access matrix
 * in `REVIEW.md` is a statement about *two* rooms, and one room alone quietly
 * stops demonstrating the rule it exists for — that owners are invisible to each
 * other.
 */
async function resolveOwners(prisma: PrismaClient): Promise<Map<string, string> | null> {
  const emails = [
    ...new Set(
      DEMO_NODES.filter((node) => node.type === 'room').map((room) =>
        room.ownerEmail.normalize('NFC').trim(),
      ),
    ),
  ];

  const owners = new Map<string, string>();

  for (const email of emails) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user === null) {
      console.log(`Demo room skipped — ${email} is not provisioned.`);
      return null;
    }
    owners.set(email, user.id);
  }

  return owners;
}

async function placeNode(
  prisma: PrismaClient,
  node: DemoNode,
  placed: Map<string, Placed>,
  owners: Map<string, string>,
): Promise<{ where: Placed; outcome: 'created' | 'exists' }> {
  // Read by id, and take the row's *actual* position for its children. A node a
  // reviewer has moved is still the node the fixture named, and rebuilding its
  // subtree at the position the fixture predicts would write paths that
  // disagree with `parent_id` — which is the one corruption `rebuildSubtree`
  // exists to repair and `nodes_path_ends_with_self` cannot catch.
  const existing = await prisma.node.findUnique({
    where: { id: node.id },
    select: { id: true, rootId: true, ownerId: true, path: true, depth: true },
  });

  if (existing !== null) return { where: existing, outcome: 'exists' };

  const rollup = subtreeRollup(node.key);

  if (node.type === 'room') {
    const ownerId = owners.get(node.ownerEmail.normalize('NFC').trim());
    if (ownerId === undefined) throw new Error(`No owner resolved for room ${node.key}.`);

    const where: Placed = {
      id: node.id,
      // A room is its own root — `nodes_root_self_reference`.
      rootId: node.id,
      ownerId,
      path: buildPath(null, node.id),
      depth: 0,
    };

    await prisma.node.create({
      data: {
        id: where.id,
        type: 'room',
        rootId: where.rootId,
        parentId: null,
        ownerId: where.ownerId,
        name: node.name,
        path: where.path,
        depth: where.depth,
        ...rollup,
      },
    });

    return { where, outcome: 'created' };
  }

  const parent = placed.get(node.parent);
  if (parent === undefined) {
    // A forward reference. Thrown rather than deferred: the fixture is ordered
    // parents-first precisely so the tree is readable as written, and a seeder
    // that quietly did two passes would let that ordering rot unnoticed.
    throw new Error(
      `Demo node ${node.key} names a parent that has not been placed: ${node.parent}`,
    );
  }

  const where: Placed = {
    id: node.id,
    rootId: parent.rootId,
    ownerId: parent.ownerId,
    path: buildPath(parent.path, node.id),
    depth: parent.depth + 1,
  };

  await prisma.node.create({
    data: {
      id: where.id,
      type: node.type,
      // `active`, not `pending`: `pending` means an upload is in flight, and
      // these files have no upload behind them at all.
      state: 'active',
      rootId: where.rootId,
      parentId: parent.id,
      ownerId: where.ownerId,
      name: node.name,
      path: where.path,
      depth: where.depth,
      ...(node.type === 'file'
        ? { sizeBytes: node.sizeBytes, contentType: node.contentType }
        : rollup),
    },
  });

  return { where, outcome: 'created' };
}

/**
 * The rollups a folder or room is created with.
 *
 * Written at insert rather than left at zero for the daily reconcile job to
 * repair, because that job reports drift it repairs — and a seeded room would
 * show up as drift on its first run, which is exactly the signal
 * `reconcileRollups` exists to make meaningful. The arithmetic matches its
 * query: descendants only, files only, and `size_bytes` summed. Files keep the
 * column defaults; the job never touches a file row either.
 */
function subtreeRollup(key: string): { subtreeFiles: number; subtreeBytes: bigint } {
  let files = 0;
  let bytes = 0n;

  for (const node of DEMO_NODES) {
    if (node.type !== 'file') continue;
    if (!isDescendant(node, key)) continue;
    files += 1;
    bytes += BigInt(node.sizeBytes);
  }

  return { subtreeFiles: files, subtreeBytes: bytes };
}

/** Strictly beneath `ancestorKey`, walking `parent` links up the fixture. */
function isDescendant(node: DemoNode, ancestorKey: string): boolean {
  const byKey = new Map(DEMO_NODES.map((entry) => [entry.key, entry]));

  let current: string | null = node.parent;
  while (current !== null) {
    if (current === ancestorKey) return true;
    const parent: DemoNode | undefined = byKey.get(current);
    if (parent === undefined) return false;
    current = parent.parent;
  }

  return false;
}

async function placeShare(
  prisma: PrismaClient,
  share: DemoShare,
  placed: Map<string, Placed>,
): Promise<string> {
  const existing = await prisma.share.findUnique({ where: { id: share.id }, select: { id: true } });
  if (existing !== null) return 'exists';

  const node = placed.get(share.nodeKey);
  if (node === undefined) throw new Error(`Demo grant ${share.id} names an unplaced node.`);

  // The owner is the grantor. There is no other candidate: `sharing` only lets
  // an owner share, so a grant created by anyone else would be a row the API
  // itself could never have produced.
  const createdById = node.ownerId;

  if (share.kind === 'user') {
    // NFC + trim, and case left alone — the same normalization
    // `SharesRepository` applies when it matches this column later. Folding case
    // here as well would be a second rule that can disagree with `citext`.
    const email = share.email.normalize('NFC').trim();
    const principal = await prisma.user.findUnique({ where: { email }, select: { id: true } });

    await prisma.share.create({
      data: {
        id: share.id,
        nodeId: node.id,
        kind: 'user',
        role: 'viewer',
        principalEmail: email,
        // Null when the invitee has no account yet. `resolveAccess` refuses a
        // grant with a null principal for everyone (`API-ACCESS-016`), so a
        // pending grant is inert rather than universal, and login binds it.
        principalUserId: principal?.id ?? null,
        createdById,
      },
    });

    return principal === null ? 'created (pending — no account)' : 'created';
  }

  assertCanonicalShortCode(share.shortCode);

  await prisma.share.create({
    data: {
      id: share.id,
      nodeId: node.id,
      kind: 'public_link',
      role: 'viewer',
      // A token is minted and then **discarded unread**. It is not printed —
      // this output reaches CI logs — and it is not fixed in the fixture,
      // because a credential committed to a repository is not a credential.
      // It exists because `shares_kind_shape` requires a public link to have
      // one; the code below is the credential the demo actually publishes, and
      // `POST /nodes/:id/shares` remains the only way to obtain a readable
      // token.
      tokenHash: sha256(randomBytes(32).toString('base64url')),
      shortCodeHash: sha256(share.shortCode),
      createdById,
    },
  });

  return 'created';
}

/**
 * Rejects a fixture code that is not already canonical.
 *
 * `ShareCodec.canonicalize` upper-cases a 16-character credential and maps
 * `I`/`L` onto `1` and `O` onto `0` before hashing, so a code stored here in any
 * other spelling would be hashed one way and looked up another. The symptom is a
 * share link that 404s — indistinguishable, by design, from a revoked one — with
 * nothing in the logs to say why. Cheaper to refuse to seed it.
 */
function assertCanonicalShortCode(code: string): void {
  const canonical =
    code.length === SHORT_CODE_LENGTH &&
    [...code].every((character) => CROCKFORD_ALPHABET.includes(character));

  if (!canonical) {
    throw new Error(
      `Demo short code ${JSON.stringify(code)} is not canonical: it must be ` +
        `${SHORT_CODE_LENGTH} characters from ${CROCKFORD_ALPHABET}.`,
    );
  }
}

/** What `shares` stores for both credential kinds. See `access/share-codec.ts`. */
function sha256(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

function describeShare(share: DemoShare): string {
  return share.kind === 'user' ? `grant → ${share.email}` : `public link → /s/${share.shortCode}`;
}

/**
 * No `user.created` event is emitted here, and that is a correction to the
 * spec rather than an omission.
 *
 * The event was specified as the fast path for binding pending share grants,
 * with login-time claiming as the guarantee behind it. But this is a **separate
 * process** — `prisma db seed` spawns `node prisma/seed.ts`, while the bus and
 * its only listener live inside the long-running API. An in-process emitter
 * cannot cross that boundary, so the fast path could never have fired. Login is
 * not the guarantee behind the mechanism; it is the mechanism.
 *
 * See HANDOFF.md §3.13.
 */
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
