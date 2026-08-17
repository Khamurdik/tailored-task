/**
 * The materialized path, and **the only file in the system that understands its
 * format.**
 *
 * `/id/id/id` — ancestors first, ending in self, slash-delimited. Pure string
 * functions with no database and no Nest, so the format can be reasoned about
 * and tested without either.
 *
 * ## The two properties everything else depends on
 *
 * **Prefix matching is only unambiguous because every segment is a fixed-width
 * UUID.** `/a/b` cannot match `/a/bc` for that reason alone. With
 * variable-length ids, `LIKE '/a/b%'` would match `/a/bc` and every cascade in
 * the system would silently over-reach — soft-delete, move and stats at once.
 * Ids are UUIDs and stay UUIDs.
 *
 * **Nothing user-controlled ever enters a path.** A `%` or `_` in a name would
 * turn every prefix query into a wildcard. Names live in their own column;
 * paths are built from ids and nothing else.
 */

const SEPARATOR = '/';

/** Rejects anything that could act as a LIKE wildcard or a delimiter. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertPathSegment(id: string): void {
  if (!UUID.test(id)) {
    // Thrown rather than sanitised. A non-UUID reaching here means an id came
    // from somewhere it should not have, and quietly cleaning it up would hide
    // the actual bug while producing a path that breaks prefix matching.
    throw new Error(`Refusing to build a path from a non-UUID segment: ${JSON.stringify(id)}`);
  }
}

/** `buildPath(parentPath, id)` — the child of a node whose path is `parentPath`. */
export function buildPath(parentPath: string | null, id: string): string {
  assertPathSegment(id);
  return `${parentPath ?? ''}${SEPARATOR}${id}`;
}

/** Ancestors, root first, excluding self. */
export function parseAncestors(path: string): string[] {
  const segments = path.split(SEPARATOR).filter((segment) => segment !== '');
  return segments.slice(0, -1);
}

export function pathDepth(path: string): number {
  return parseAncestors(path).length;
}

/**
 * The prefix that matches this node **and its whole subtree**.
 *
 * The trailing separator is what makes it a subtree query rather than a
 * sibling-prefix query. Without it, `/a/b` would also match a hypothetical
 * `/a/bc` — which fixed-width UUIDs already prevent, so this is belt and
 * braces on the one predicate the entire cascade design rests on.
 */
export function subtreePrefix(path: string): string {
  return `${path}${SEPARATOR}`;
}

/**
 * True when `candidate` is `ancestor` or anything beneath it.
 *
 * This is the cycle check. A move is illegal when the destination is the moved
 * node itself or one of its descendants — the move that looks perfectly legal
 * from the parent's side and silently detaches a subtree.
 */
export function isSelfOrDescendant(ancestorPath: string, candidatePath: string): boolean {
  return candidatePath === ancestorPath || candidatePath.startsWith(subtreePrefix(ancestorPath));
}

/**
 * Rewrites a path from one subtree root to another.
 *
 * Deliberately not `replace(path, oldPrefix, newPrefix)`: SQL's `replace` is
 * global, so a path that happened to contain the old prefix twice would have
 * both occurrences rewritten. It cannot happen with a well-formed tree — an id
 * appears once — but the version that only touches the front is correct for the
 * malformed case too, and costs nothing.
 */
export function rebase(path: string, fromPath: string, toPath: string): string {
  if (!isSelfOrDescendant(fromPath, path)) {
    throw new Error(`Path ${path} is not inside ${fromPath}`);
  }
  return `${toPath}${path.slice(fromPath.length)}`;
}

/**
 * Escapes a value for use as a `LIKE` pattern prefix.
 *
 * Paths are built from UUIDs so they contain no wildcards, which makes this
 * unnecessary today — and it is here anyway, because "the input can't contain a
 * wildcard" is an assumption that holds until someone changes the id format,
 * and the failure then is silent over-matching rather than an error.
 */
export function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/([%_\\])/g, '\\$1');
}
