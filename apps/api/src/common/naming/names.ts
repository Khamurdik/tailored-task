import { MAX_NAME_LENGTH } from '@dataroom/shared';

/**
 * Name handling. Pure functions, no domain knowledge — `nodes` decides what a
 * name means, this decides what a name *is*.
 */

/**
 * U+202A-U+202E and U+2066-U+2069. A right-to-left override renders
 * `annual-report-fdp.exe` as `annual-report-exe.pdf` - the filename a user
 * reads and the filename the system stores stop being the same string.
 *
 * Written as escapes rather than as the characters themselves, because they
 * are invisible: pasted literally, the next person to edit this file cannot
 * see what the character class contains.
 */
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/g;
const PATH_SEPARATORS = /[/\\]/g;
/**
 * Stripping control characters is the entire point of this pattern, so the
 * rule that objects to them is the one thing it cannot obey. A name holding
 * a NUL or an ESC is either a bug or an attempt to forge a log line, and
 * neither belongs in the tree.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const WHITESPACE_RUN = /\s+/g;

/**
 * NFC-normalize, trim, and collapse internal whitespace runs to one space.
 *
 * The normalization is the part that matters. `café` composed and `café`
 * decomposed are different byte strings that render identically, so without
 * this a uniqueness check lets both into the same folder and the user sees two
 * rows with the same name and no way to tell them apart.
 */
export function normalizeName(input: string): string {
  return input.normalize('NFC').replace(WHITESPACE_RUN, ' ').trim();
}

/**
 * Strip everything that could change what a name *means* somewhere else, then
 * cap it.
 *
 * Order matters: normalize first so the length cap counts the characters a user
 * would count, and strip before capping so a truncation cannot leave a
 * half-removed sequence behind.
 */
export function sanitizeName(input: string): string {
  const stripped = normalizeName(input)
    .replace(CONTROL_CHARS, '')
    .replace(BIDI_OVERRIDES, '')
    .replace(PATH_SEPARATORS, '')
    .replaceAll('..', '')
    .trim();

  return stripped.length > MAX_NAME_LENGTH ? stripped.slice(0, MAX_NAME_LENGTH).trim() : stripped;
}

/**
 * Splits a name into the part a `(n)` suffix goes after, and the extension.
 *
 * A leading dot is a dotfile, not an extension: `.env` must suffix to
 * `.env (1)`, never to ` (1).env`.
 */
function splitExtension(name: string): { stem: string; extension: string } {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) return { stem: name, extension: '' };
  return { stem: name.slice(0, lastDot), extension: name.slice(lastDot) };
}

const EXISTING_SUFFIX = /^(.*?)\s\((\d+)\)$/;

/**
 * `suggestConflictName('a.pdf', taken)` → `'a (1).pdf'`.
 *
 * Two rules that are easy to get wrong and produce names nobody wants:
 * the suffix goes **before** the extension, and a name that already ends in
 * `(n)` **increments** rather than nesting — otherwise a folder that has been
 * uploaded to a few times fills up with `report (1) (1) (1).pdf`.
 *
 * The result is capped at `MAX_NAME_LENGTH`, which means a name already at the
 * cap has to give up characters from its stem to make room for the suffix. It
 * loses the middle of its name rather than its extension, because the extension
 * is what decides how the file opens.
 */
export function suggestConflictName(name: string, taken: ReadonlySet<string> | string[]): string {
  const isTaken = Array.isArray(taken) ? new Set(taken) : taken;
  if (!isTaken.has(name)) return name;

  const { stem, extension } = splitExtension(name);
  const match = EXISTING_SUFFIX.exec(stem);
  const base = match?.[1] ?? stem;
  const start = match?.[2] === undefined ? 1 : Number(match[2]) + 1;

  for (let n = start; n < start + 10_000; n += 1) {
    const candidate = fit(base, ` (${n})`, extension);
    if (!isTaken.has(candidate)) return candidate;
  }

  // Unreachable in practice — 10,000 collisions on one stem in one folder.
  // Throwing beats returning a name that is already taken.
  throw new Error(`Could not find a free name for "${name}" after 10000 attempts`);
}

function fit(base: string, suffix: string, extension: string): string {
  const room = MAX_NAME_LENGTH - suffix.length - extension.length;
  const stem = base.length > room ? base.slice(0, Math.max(room, 0)).trimEnd() : base;
  return `${stem}${suffix}${extension}`;
}
