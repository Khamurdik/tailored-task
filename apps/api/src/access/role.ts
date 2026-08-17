import type { Role } from '@dataroom/shared';

/**
 * Roles, ascending.
 *
 * The order is the definition: `max(role)` across a node and its ancestors is an
 * **ordinal maximum**, which only means anything if the union is ranked. That is
 * why the shared union is declared in this order rather than alphabetically, and
 * why this file turns it into numbers rather than comparing strings.
 */
const RANK: Record<Role, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  owner: 3,
};

export function rankOf(role: Role): number {
  return RANK[role];
}

export function maxRole(...roles: Role[]): Role {
  return roles.reduce((highest, role) => (RANK[role] > RANK[highest] ? role : highest), 'none');
}

export type Verb = 'read' | 'write' | 'own';

/**
 * The minimum role each verb needs.
 *
 * `editor` is deliberately defined and **never issued** — nothing in the
 * codebase creates one, and the database refuses `none` and `owner` outright. It
 * exists so that adding per-user write access later is a data change rather than
 * a schema change, and the claim should be visibly true in the code rather than
 * asserted in a README. `API-ACCESS-013` checks it.
 */
const MINIMUM: Record<Verb, Role> = {
  read: 'viewer',
  write: 'editor',
  own: 'owner',
};

export function satisfies(role: Role, verb: Verb): boolean {
  return RANK[role] >= RANK[MINIMUM[verb]];
}

export function minimumFor(verb: Verb): Role {
  return MINIMUM[verb];
}
