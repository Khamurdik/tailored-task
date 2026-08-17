import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static checks over the source tree, for two claims no runtime test can make.
 *
 * "No HTTP route creates a user" is a statement about code that does not exist,
 * and the only way to assert the absence of something is to go and look.
 */
const API_SRC = resolve(process.cwd(), '../apps/api/src');
const SEED_ENTRY = resolve(process.cwd(), '../apps/api/prisma/seed.ts');

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) found.push(full);
  }
  return found;
}

/** Comments are not code — the same lesson the registry scanner learned. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

/**
 * Every module `prisma/seed.ts` pulls in, followed by hand.
 *
 * The zone is defined by reachability rather than by a list, because a list is
 * a thing someone updates and reachability is a thing the loader computes. One
 * `import` added to a leaf file is all it takes to widen it.
 */
function stripSafeZone(): string[] {
  const seen = new Set<string>();
  const queue = [SEED_ENTRY];

  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(/from\s+'(\.[^']+)'/g)) {
      const specifier = match[1] ?? '';
      const resolved = resolve(dirname(file), specifier);
      queue.push(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`);
    }
  }

  return [...seen];
}

describe('provisioning is not self-service', () => {
  it('API-USERS-014 no HTTP route in the application creates a user row', () => {
    const creators: string[] = [];

    for (const file of sourceFiles(API_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/\bprisma\.user\.create\b|\buser\.create\(|\busers\.create\(/.test(code)) {
        creators.push(file.slice(API_SRC.length + 1));
      }
    }

    /**
     * Nothing under `src/` may create a user — the seeder lives in `prisma/`
     * and is a separate process.
     *
     * Written as a scan rather than by enumerating endpoints, because the
     * hand-written version rots the moment someone adds a controller. This is
     * what makes "there is no registration" a property of the code rather than
     * a claim in a README: `UsersService` has no `create` method at all, and the
     * missing method is the enforcement.
     */
    expect(creators, 'only prisma/seed.ts may create a user').toEqual([]);
  });

  it('API-USERS-016 nothing in the strip-safe zone uses syntax Node cannot strip', () => {
    const zone = stripSafeZone();

    // The zone is meant to stay tiny: this file, plus two named leaf modules.
    // Every module added is a module that can never use constructor injection.
    expect(zone.length, `zone: ${zone.map((f) => f.split('/').slice(-2).join('/')).join(', ')}`)
      .toBeLessThanOrEqual(4);

    const violations: string[] = [];

    for (const file of zone) {
      const name = file.split('/').slice(-2).join('/');
      const code = stripComments(readFileSync(file, 'utf8'));

      // A decorator — SyntaxError at the `@`.
      if (/^\s*@[A-Za-z]/m.test(code)) violations.push(`${name}: decorator`);
      // `enum` — ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Importing one is the same
      // hazard from the other side: a const enum member is inlined by a
      // compiler, of which there is none here.
      if (/^\s*(export\s+)?(const\s+)?enum\s/m.test(code)) violations.push(`${name}: enum`);
      // A parameter property — same error, and it rules out ordinary
      // constructor injection, not just `@Injectable()`.
      if (/constructor\s*\([^)]*\b(private|public|protected|readonly)\s/s.test(code)) {
        violations.push(`${name}: parameter property`);
      }
      // An extensionless relative import — ERR_MODULE_NOT_FOUND. This is the
      // sharp one: every *other* file in `apps/api` is extensionless, because
      // the package compiles under `moduleResolution: node10`.
      for (const match of code.matchAll(/from\s+'(\.[^']+)'/g)) {
        const specifier = match[1] ?? '';
        if (!specifier.endsWith('.ts') && !specifier.endsWith('.js')) {
          violations.push(`${name}: extensionless import '${specifier}'`);
        }
      }
    }

    // 016 exists so 015's failure says *which* rule was broken. On its own,
    // 015 fails with a bare `SyntaxError` and no indication of the cause.
    expect(violations).toEqual([]);
  });
});
