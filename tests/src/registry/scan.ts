/**
 * Finds the declaration ids a spec file implements.
 *
 * An id counts as implemented when it appears in a **string literal** in a spec
 * file under `suites/`.
 *
 * Two deliberate choices in that sentence. **Spec files, not run output** —
 * reading Vitest results would leave all 39 `JOURNEY-*` declarations
 * permanently unimplemented, since Vitest never collects Playwright. And
 * **string literals, not `it(...)` titles specifically** — titles are built by
 * `it.each`, by template strings, and by helpers, and a scanner that only
 * understands one call shape reports honest work as missing.
 *
 * ## Why this is not one regex over the whole file
 *
 * It was, and it was wrong in a way worth keeping a note about. Pairing quotes
 * across an entire file means a single apostrophe in prose — `the block's
 * contents`, in a comment — opens a "string" that runs to the next quote
 * somewhere further down, swallowing every id in between. The symptom was four
 * tests that pass silently reverting to unimplemented, which is the worst
 * possible failure for a coverage gate: it under-reports, quietly, and looks
 * like ordinary red.
 *
 * So: comments come out first, and the remaining literals are matched one line
 * at a time. A stray quote can then only corrupt its own line.
 *
 * The cost is a title inside a multi-line template literal, which this will
 * miss. That is a trade in the safe direction — it reports missing work as
 * missing rather than reporting real work as absent.
 */

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*(?:\/\/|\*)/;
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\n])*?)\1/g;
const ID_IN_TEXT = /\b[A-Z]+(?:-[A-Z0-9]+)*-\d{3}\b/g;

export function scanImplementedIds(source: string): string[] {
  const found = new Set<string>();

  for (const line of source.replace(BLOCK_COMMENT, '').split('\n')) {
    if (LINE_COMMENT.test(line)) continue;

    for (const [, , literal] of line.matchAll(STRING_LITERAL)) {
      for (const id of (literal ?? '').match(ID_IN_TEXT) ?? []) found.add(id);
    }
  }

  return [...found];
}
