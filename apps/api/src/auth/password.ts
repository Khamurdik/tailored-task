/**
 * argon2id hashing — a **strip-safe leaf module**.
 *
 * `prisma db seed` runs `node prisma/seed.ts` under Node's type stripping, and
 * the whole transitive import graph of that file is subject to four rules. So
 * this file has:
 *
 *   1. no decorators
 *   2. no parameter properties (which rules out constructor injection, and so
 *      rules out putting these on a Nest service)
 *   3. no `enum`
 *   4. **no relative imports at all** — `@node-rs/argon2` below is a bare
 *      specifier, which resolves normally
 *
 * `AuthService` wraps these functions for DI. It must not reimplement them:
 * the seeder and the login path have to agree on the parameters exactly, and
 * the failure when they do not is a seeded user who cannot log in, presenting
 * as a wrong password. Divergence here is silent, which is why there is one
 * definition and everything else calls it.
 */
import { hash, verify } from '@node-rs/argon2';

/**
 * OWASP's second recommended argon2id configuration: 19 MiB, 2 iterations,
 * 1 degree of parallelism. Chosen over the 46 MiB variant because App Runner
 * instances are small and login is the one endpoint an attacker gets to call
 * repeatedly — memory per hash is memory per concurrent login attempt.
 *
 * Changing any of these invalidates nothing: argon2 encodes its parameters in
 * the hash string, so existing hashes keep verifying with the parameters they
 * were made with. New hashes use these.
 */
const PARAMS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * `algorithm` is deliberately not passed, and the reason is a strip-safe-zone
 * hazard rather than a preference.
 *
 * `@node-rs/argon2` declares `Algorithm` as an **ambient const enum**, so
 * `Algorithm.Argon2id` is a compile-time inlined constant. Two problems, and
 * the first is what a reviewer notices while the second is what would have
 * shipped:
 *
 *   - `isolatedModules` rejects reading an ambient const enum outright
 *     (TS2748), which is how this surfaced;
 *   - and there is no compiler at all when Node strips types to run
 *     `prisma/seed.ts`, so an inlined constant has nothing to inline it. The
 *     `enum` rule in the strip-safe zone is usually read as "do not write one".
 *     Importing one from a dependency is the same hazard from the other side.
 *
 * argon2id is this library's default, verified by execution: omitting the
 * option produces `$argon2id$v=19$m=19456,t=2,p=1`. Taking the default is the
 * fix; a bare `algorithm: 2` would work and would be a magic number nobody
 * could check.
 */

/**
 * A hash of a value nobody knows, used to spend the same time verifying a
 * password for an email that does not exist as for one that does.
 *
 * Without it, "no such user" returns in microseconds and "wrong password"
 * returns in ~50ms, and the difference is a reliable oracle for whether an
 * address is registered — in a product whose whole point is that the guest
 * list is confidential.
 *
 * Computed lazily and once: at module load it would add its cost to boot, and
 * to the seed script, which never verifies anything.
 */
let dummyHash: string | undefined;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, PARAMS);
}

export async function verifyPassword(
  storedHash: string | null | undefined,
  plaintext: string,
): Promise<boolean> {
  if (storedHash === null || storedHash === undefined || storedHash === '') {
    // A user with no password (Google-only) must not be a fast "no", and must
    // never be a "yes". Burn the same time, then refuse.
    await verifyAgainstDummy(plaintext);
    return false;
  }

  try {
    return await verify(storedHash, plaintext, PARAMS);
  } catch {
    // A malformed stored hash is a data problem, not an authentication
    // success. Failing closed is the only safe reading.
    return false;
  }
}

/** Call when no user was found, so the response time does not reveal that. */
export async function verifyAgainstDummy(plaintext: string): Promise<false> {
  dummyHash ??= await hash('dummy-password-for-constant-time-comparison', PARAMS);
  try {
    await verify(dummyHash, plaintext, PARAMS);
  } catch {
    // Ignored by design: the result is discarded either way. This exists to
    // spend time, not to answer a question.
  }
  return false;
}
