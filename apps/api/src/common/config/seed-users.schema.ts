/**
 * The `SEED_USERS` contract — a **strip-safe leaf module**.
 *
 * `prisma db seed` runs `node prisma/seed.ts`, which Node 26 executes under
 * type stripping: annotations are erased and the result runs, with no compiler.
 * Four things fail there, all verified by execution on 26.7.0 — decorators,
 * parameter properties, `enum`, and extensionless relative imports — and the
 * whole transitive import graph of `seed.ts` is subject to all four.
 *
 * So this file obeys four rules, and they are not negotiable:
 *
 *   1. no decorators
 *   2. no parameter properties (which rules out constructor injection, and so
 *      rules out almost any Nest service, decorated or not)
 *   3. no `enum`
 *   4. **no relative imports at all.** Bare specifiers resolve normally and are
 *      fine; `zod` below is one
 *
 * It must stay a leaf. `common`'s config module may import *this*; this may
 * never import back into `common`. An earlier revision of the spec said the
 * seeder should reuse "the same zod config schema `common` uses" without
 * noticing that `common`'s config module is a Nest provider and would take the
 * seed down with it.
 */
import { z } from 'zod';

export const SeedUserSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1),
  name: z.string().min(1),
  /** Optional, defaults false. The only route to `is_admin` in the system. */
  admin: z.boolean().default(false),
});

export type SeedUser = z.infer<typeof SeedUserSchema>;

export const SeedUsersSchema = z.array(SeedUserSchema);

/**
 * Parses the raw environment value. A JSON array rather than a delimited
 * string, so a name or password containing `,` `:` or `"` is not a parsing
 * problem.
 *
 * Throws with a readable message rather than returning a result: both callers
 * — boot and the seeder — want to die immediately and loudly, and a malformed
 * seed discovered halfway through an insert is worse than one discovered
 * before the first.
 */
export function parseSeedUsers(raw: string | undefined): SeedUser[] {
  if (raw === undefined || raw.trim() === '') return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `SEED_USERS is not valid JSON. It must be a JSON array, e.g. ` +
        `'[{"email":"ana@corp.com","password":"…","name":"Ana","admin":true}]'. ` +
        `Parser said: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const result = SeedUsersSchema.safeParse(parsed);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  SEED_USERS[${issue.path.join('.')}]: ${issue.message}`)
      .join('\n');
    throw new Error(`SEED_USERS is malformed:\n${problems}`, { cause: result.error });
  }

  return result.data;
}
