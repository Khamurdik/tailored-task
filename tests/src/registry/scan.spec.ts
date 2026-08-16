import { describe, expect, it } from 'vitest';

import { scanImplementedIds } from './scan.ts';

/**
 * The scanner decides what counts as implemented, so a bug in it moves the
 * only number this project reports. It under-reports silently — a missed id
 * looks exactly like work nobody has done yet — which is why it is tested
 * rather than trusted.
 *
 * These ids are deliberately shaped like real ones but belong to a suite that
 * does not exist. Safe because the registry only scans `suites/**`, and this
 * file is in `src/`.
 */
describe('implementation scanner', () => {
  it('finds an id in an ordinary test title', () => {
    expect(scanImplementedIds(`it('FAKE-SCAN-001 does a thing', () => {});`)).toEqual([
      'FAKE-SCAN-001',
    ]);
  });

  it('finds ids in template literals and each-tables, not just plain it() calls', () => {
    const source = [
      'const cases = ["FAKE-SCAN-002", "FAKE-SCAN-003"];',
      'it.each(cases)(`%s resolves`, (id) => {});',
      'test(`FAKE-SCAN-004 works`, () => {});',
    ].join('\n');

    expect(scanImplementedIds(source).sort()).toEqual([
      'FAKE-SCAN-002',
      'FAKE-SCAN-003',
      'FAKE-SCAN-004',
    ]);
  });

  it('is not derailed by an apostrophe in prose', () => {
    // The regression this file exists for. A whole-file quote scan reads the
    // apostrophe in "block's" as an opening quote and swallows everything up
    // to the next one — which silently un-implemented four passing tests.
    const source = [
      `it('FAKE-SCAN-005 first', () => {});`,
      `// Anchored on the block's contents rather than the line above it.`,
      `it('FAKE-SCAN-006 second', () => {});`,
      `/* A comment that mentions the parser's job. */`,
      `it('FAKE-SCAN-007 third', () => {});`,
    ].join('\n');

    expect(scanImplementedIds(source).sort()).toEqual([
      'FAKE-SCAN-005',
      'FAKE-SCAN-006',
      'FAKE-SCAN-007',
    ]);
  });

  it('ignores an id that appears only in a comment', () => {
    // A commented-out or planned test is not an implementation. Counting it
    // would let a TODO note mark a requirement as done.
    const source = [
      `// TODO: FAKE-SCAN-008 once the guard exists`,
      `/* it('FAKE-SCAN-009 disabled', () => {}); */`,
      ` * FAKE-SCAN-010 mentioned in a jsdoc block`,
    ].join('\n');

    expect(scanImplementedIds(source)).toEqual([]);
  });

  it('reports each id once however many times it appears', () => {
    const source = [
      `describe('FAKE-SCAN-011', () => {`,
      `  it('FAKE-SCAN-011 a', () => {});`,
      `  it('FAKE-SCAN-011 b', () => {});`,
      `});`,
    ].join('\n');

    expect(scanImplementedIds(source)).toEqual(['FAKE-SCAN-011']);
  });
});
