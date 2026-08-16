/**
 * Parses `## Declared tests` tables out of a suite's TODO.md.
 *
 * The markdown is the registry. There is no second list to keep in sync, which
 * is the whole point — a declaration that is documentation and data cannot
 * drift from itself.
 */

export type Kind = 'unit' | 'integration' | 'property' | 'security' | 'journey';
export type Priority = 'P0' | 'P1' | 'P2';

export interface Declaration {
  id: string;
  behaviour: string;
  kind: Kind;
  priority: Priority;
  /** The `###` heading this row sits under. */
  group: string;
  /** Suite path relative to `tests/`, e.g. `suites/api/access`. */
  suite: string;
  /** A retired row keeps its number and leaves the declared count. */
  retired: boolean;
  /** 1-based line in the source file, so a parse error is clickable. */
  line: number;
}

export interface ParseProblem {
  suite: string;
  line: number;
  message: string;
}

export interface ParsedSuite {
  suite: string;
  declarations: Declaration[];
  problems: ParseProblem[];
}

const ID_PATTERN = /^[A-Z]+(-[A-Z0-9]+)*-\d{3}$/;
const KINDS: readonly string[] = ['unit', 'integration', 'property', 'security', 'journey'];
const PRIORITIES: readonly string[] = ['P0', 'P1', 'P2'];

/** Strip markdown emphasis and links so a behaviour reads as plain prose. */
function plain(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  return trimmed
    .slice(1, trimmed.endsWith('|') ? -1 : undefined)
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * A row is a declaration only if it has four cells and its first cell looks
 * like an ID. Header rows, separators, and the `## Personas` table in
 * `suites/journeys` all fall out of that test rather than needing a special
 * case — except that we never see Personas at all, because only the
 * `## Declared tests` section is read.
 */
export function parseSuite(suite: string, source: string): ParsedSuite {
  const declarations: Declaration[] = [];
  const problems: ParseProblem[] = [];
  const lines = source.split('\n');

  let inSection = false;
  let group: string | null = null;

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    const lineNo = index + 1;

    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      inSection = /^##\s+Declared tests\s*$/.test(line);
      group = null;
      continue;
    }
    if (!inSection) continue;

    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      group = plain(heading[1]);
      continue;
    }

    if (!line.startsWith('|')) continue;

    const cells = splitRow(line);
    const id = cells[0];
    if (id === undefined || id === 'ID' || /^-{2,}$/.test(id)) continue;

    if (!ID_PATTERN.test(id)) {
      problems.push({
        suite,
        line: lineNo,
        message: `"${id}" is not a valid declaration id (AREA-MODULE-NNN)`,
      });
      continue;
    }

    if (cells.length !== 4) {
      problems.push({
        suite,
        line: lineNo,
        message: `${id}: expected 4 columns (ID, Behaviour, Kind, Pri), found ${cells.length}`,
      });
      continue;
    }

    const behaviour = plain(cells[1] ?? '');
    const kind = (cells[2] ?? '').trim();
    const priority = (cells[3] ?? '').trim();

    if (!KINDS.includes(kind)) {
      problems.push({ suite, line: lineNo, message: `${id}: unknown Kind "${kind}"` });
      continue;
    }
    if (!PRIORITIES.includes(priority)) {
      problems.push({ suite, line: lineNo, message: `${id}: unknown Pri "${priority}"` });
      continue;
    }

    declarations.push({
      id,
      behaviour,
      kind: kind as Kind,
      priority: priority as Priority,
      // A suite with no `###` is one group named after the suite.
      group: group ?? suite.split('/').slice(-1)[0] ?? suite,
      suite,
      retired: /\bRETIRED\b/.test(cells[1] ?? ''),
      line: lineNo,
    });
  }

  if (!/^##\s+Declared tests\s*$/m.test(source)) {
    problems.push({ suite, line: 1, message: 'no `## Declared tests` section' });
  }

  return { suite, declarations, problems };
}
