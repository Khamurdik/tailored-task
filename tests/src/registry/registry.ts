import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseSuite, type Declaration, type ParseProblem } from './parser.ts';
import { scanImplementedIds } from './scan.ts';

/** `tests/` — the root everything below is relative to. */
export const TESTS_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const SUITES_DIR = join(TESTS_ROOT, 'suites');
const SPEC_PATTERN = /\.spec\.tsx?$/;

export interface Registry {
  declarations: Declaration[];
  problems: ParseProblem[];
  /** IDs found in spec files, mapped to the files that carry them. */
  implementations: Map<string, string[]>;
}

export interface RegistrySummary {
  /** Live declarations. Retired rows keep their number and leave this count. */
  declared: number;
  retired: number;
  implemented: number;
  p0: number;
  p0Implemented: number;
  groups: number;
  suites: number;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

export function loadRegistry(): Registry {
  const files = walk(SUITES_DIR);
  const declarations: Declaration[] = [];
  const problems: ParseProblem[] = [];
  const implementations = new Map<string, string[]>();

  for (const file of files) {
    const rel = toPosix(relative(TESTS_ROOT, file));

    if (file.endsWith('TODO.md')) {
      const suite = rel.replace(/\/TODO\.md$/, '');
      const parsed = parseSuite(suite, readFileSync(file, 'utf8'));
      declarations.push(...parsed.declarations);
      problems.push(...parsed.problems);
      continue;
    }

    if (!SPEC_PATTERN.test(file)) continue;

    for (const id of scanImplementedIds(readFileSync(file, 'utf8'))) {
      const seen = implementations.get(id);
      if (seen) seen.push(rel);
      else implementations.set(id, [rel]);
    }
  }

  const byId = new Map<string, Declaration>();
  for (const declaration of declarations) {
    const existing = byId.get(declaration.id);
    if (existing) {
      problems.push({
        suite: declaration.suite,
        line: declaration.line,
        message: `${declaration.id} is already declared in ${existing.suite}:${existing.line}. Ids are globally unique and are never reused`,
      });
      continue;
    }
    byId.set(declaration.id, declaration);
  }

  declarations.sort((a, b) => a.id.localeCompare(b.id));
  return { declarations, problems, implementations };
}

export function live(registry: Registry): Declaration[] {
  return registry.declarations.filter((d) => !d.retired);
}

/** Declared, not retired, and no spec file names it. These are run #1's red. */
export function unimplemented(registry: Registry): Declaration[] {
  return live(registry).filter((d) => !registry.implementations.has(d.id));
}

/**
 * A spec that names an id nobody declared. Tests do not appear from nowhere:
 * either the declaration was deleted (it should have been retired instead) or
 * the id in the title is a typo, and a typo here silently un-implements a
 * requirement.
 */
export function undeclared(registry: Registry): { id: string; files: string[] }[] {
  const known = new Set(registry.declarations.map((d) => d.id));
  return [...registry.implementations]
    .filter(([id]) => !known.has(id))
    .map(([id, files]) => ({ id, files }));
}

export function summarize(registry: Registry): RegistrySummary {
  const liveOnes = live(registry);
  const implemented = liveOnes.filter((d) => registry.implementations.has(d.id));
  const p0 = liveOnes.filter((d) => d.priority === 'P0');

  return {
    declared: liveOnes.length,
    retired: registry.declarations.length - liveOnes.length,
    implemented: implemented.length,
    p0: p0.length,
    p0Implemented: p0.filter((d) => registry.implementations.has(d.id)).length,
    groups: new Set(liveOnes.map((d) => `${d.suite}#${d.group}`)).size,
    suites: new Set(registry.declarations.map((d) => d.suite)).size,
  };
}
