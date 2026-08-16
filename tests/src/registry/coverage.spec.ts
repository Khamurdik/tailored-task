import { describe, expect, it } from 'vitest';

import {
  loadRegistry,
  live,
  summarize,
  undeclared,
  unimplemented,
  type Registry,
} from './registry.ts';

/**
 * The coverage gate.
 *
 * A TDD harness that reports "0 tests, all passing" on day one is lying — it
 * has no idea how much is missing. So this suite emits **one failing test per
 * declared-but-unimplemented id**, which makes run #1 red by construction and
 * turns progress into `implemented / declared` rather than a percentage of
 * whatever tests happen to exist.
 *
 * It lives in `src/` and runs as its own Vitest project (`gate`) because every
 * other project includes only `suites/**`. Without a project of its own it is
 * never collected, and run #1 is green by accident — the exact failure this
 * file exists to prevent.
 */
const registry: Registry = loadRegistry();
const summary = summarize(registry);

describe('registry', () => {
  it('parses every suite without a structural problem', () => {
    const problems = registry.problems.map((p) => `${p.suite}:${p.line} — ${p.message}`);
    expect(problems).toEqual([]);
  });

  it('declares at least one test', () => {
    expect(summary.declared).toBeGreaterThan(0);
  });

  it('has no implementation whose id was never declared', () => {
    const strays = undeclared(registry).map(
      ({ id, files }) => `${id} implemented in ${files.join(', ')} but never declared`,
    );
    expect(strays).toEqual([]);
  });
});

/**
 * Retired rows are checked rather than ignored. The row survives so the number
 * is never reused; the requirement is gone. Implementing one anyway means
 * somebody read a struck-through row as live.
 */
describe('retired declarations', () => {
  const retired = registry.declarations.filter((d) => d.retired);

  it(`keeps ${retired.length} retired ids out of the declared count`, () => {
    expect(summary.declared + summary.retired).toBe(registry.declarations.length);
  });

  for (const declaration of retired) {
    it(`${declaration.id} is retired and has no implementation`, () => {
      expect(registry.implementations.get(declaration.id) ?? []).toEqual([]);
    });
  }
});

describe('coverage', () => {
  const missing = unimplemented(registry);

  it(`reports ${summary.implemented} of ${summary.declared} declared, ${summary.p0Implemented} of ${summary.p0} P0`, () => {
    // Not an assertion about progress — this row exists so the run log always
    // carries the ratio, including on a run where nothing else changed.
    expect(summary.implemented).toBeLessThanOrEqual(summary.declared);
  });

  for (const declaration of missing) {
    it(`${declaration.id} [${declaration.priority}] ${declaration.behaviour}`, () => {
      expect.fail(
        `Not implemented. Declared in ${declaration.suite}/TODO.md:${declaration.line} ` +
          `under "${declaration.group}". Write it in ${declaration.suite}/ with the id in the test title.`,
      );
    });
  }

  if (missing.length === 0) {
    it('every declaration is implemented', () => {
      expect(live(registry)).toHaveLength(summary.declared);
    });
  }
});
