import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static checks over the API source tree.
 *
 * These defend boundaries that no runtime test can see: a module that starts
 * reading `shares` directly still passes every behavioural test, right up until
 * two implementations of the permission rules disagree.
 */
const API_SRC = resolve(process.cwd(), '../apps/api/src');

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

describe('denial and boundaries', () => {
  it('API-ACCESS-014 no module outside access reads the shares table', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(API_SRC)) {
      const relative = file.slice(API_SRC.length + 1);
      if (relative.startsWith('access/')) continue;

      const code = stripComments(readFileSync(file, 'utf8'));
      // Prisma's model accessor and the raw table name. Either one appearing
      // outside `access` means a second place now knows how grants are stored.
      if (/\bprisma\.share\b|\.share\.(findMany|findFirst|findUnique|create|update|delete)|"shares"/.test(code)) {
        offenders.push(relative);
      }
    }

    expect(offenders, 'only access/ may touch the shares table').toEqual([]);
  });

  it('API-ACCESS-013 no code path issues the editor role', () => {
    const issuers: string[] = [];

    for (const file of sourceFiles(API_SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A literal `'editor'` assigned to a role. The enum defines it; nothing
      // may create one, which is what makes "adding per-user write access is a
      // data change, not a schema change" true rather than aspirational.
      if (/role:\s*'editor'/.test(code)) issuers.push(file.slice(API_SRC.length + 1));
    }

    expect(issuers, 'editor is defined and never issued').toEqual([]);
  });

  it('API-ACCESS-017 access never imports nodes', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(join(API_SRC, 'access'))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      if (/from\s+'\.\.\/nodes/.test(code)) violations.push(file.slice(API_SRC.length + 1));
    }

    // The inverted dependency is the whole reason `NODE_LOOKUP` exists. If this
    // fails, the port has been bypassed and the cycle is back.
    expect(violations).toEqual([]);
  });

  it('API-ACCESS-018 there is no forwardRef anywhere in the codebase', () => {
    const uses: string[] = [];

    for (const file of sourceFiles(API_SRC)) {
      if (/\bforwardRef\b/.test(stripComments(readFileSync(file, 'utf8')))) {
        uses.push(file.slice(API_SRC.length + 1));
      }
    }

    // The stated rule, made falsifiable: "if you find yourself reaching for one,
    // a boundary is wrong."
    expect(uses).toEqual([]);
  });
});
