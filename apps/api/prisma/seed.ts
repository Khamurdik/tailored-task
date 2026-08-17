/**
 * `prisma db seed` — the only thing in this system that creates a user.
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
 * The zone is two named leaf modules and this file. Do not widen it casually:
 * every module added is a module that can never use constructor injection.
 */
import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/auth/password.ts';
import { parseSeedUsers } from '../src/common/config/seed-users.schema.ts';

type Outcome = 'created' | 'updated' | 'password reset' | 'unchanged';

async function main(): Promise<void> {
  const users = parseSeedUsers(process.env.SEED_USERS);
  const forceReset = process.env.SEED_FORCE_RESET === 'true';

  if (users.length === 0) {
    console.log('SEED_USERS is empty — nothing to provision.');
    return;
  }

  const prisma = new PrismaClient();

  try {
    for (const user of users) {
      const outcome = await upsert(prisma, user, forceReset);
      // The email, and what happened to it. Never the password and never the
      // hash — this output goes to CI logs and to a terminal someone may be
      // sharing.
      console.log(`  ${user.email.padEnd(32)} ${outcome}`);
    }
    console.log(`Seeded ${users.length} user(s).`);
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
