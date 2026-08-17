import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppError, normalizeName, sanitizeName, suggestConflictName } from '../common';
import { NodesRepository } from './nodes.repository';

@Injectable()
export class NodeNamingService {
  constructor(private readonly nodes: NodesRepository) {}

  /** Normalize → sanitize, then reject what is left of nothing. */
  prepare(raw: string): string {
    const name = sanitizeName(normalizeName(raw));
    if (name === '') throw AppError.validationFailed({ name: 'A name is required' });
    return name;
  }

  /**
   * The next free name for `requested` among live siblings.
   *
   * Read fresh on every attempt. A set captured before the first try keeps
   * proposing names that other transactions have taken since.
   */
  async nextFreeName(
    requested: string,
    parentId: string | null,
    ownerId: string,
    alsoTaken: readonly string[] = [],
  ): Promise<string> {
    const siblings = await this.nodes.liveSiblingNames(parentId, ownerId);
    return suggestConflictName(requested, new Set([...siblings, ...alsoTaken]));
  }

  /**
   * The name a client is offered when a *deliberate* rename collides.
   *
   * Distinct from the upload path on purpose: an upload silently renaming is good
   * behaviour, and a rename silently renaming is not — the user typed a specific
   * name, so they get a 409 with a suggestion and decide.
   */
  async suggestFor(
    requested: string,
    parentId: string | null,
    ownerId: string,
    excludeId?: string,
  ): Promise<string> {
    const name = this.prepare(requested);
    const taken = new Set(await this.nodes.liveSiblingNames(parentId, ownerId));

    // A node keeps its own name when renamed within the same folder; excluding
    // it stops `Report.pdf` → `Report.pdf` suggesting `Report (1).pdf`.
    if (excludeId !== undefined) {
      const own = await this.nodes.findById(excludeId);
      if (own !== null) taken.delete(own.name);
    }

    return suggestConflictName(name, taken);
  }
}

/**
 * Whether a failure is a unique-constraint violation, however it surfaced.
 *
 * Three spellings, and the third is the one that cost a debugging session:
 *
 *   - `P2002` — Prisma's model API noticed the constraint;
 *   - `23505` — the Postgres code, from a driver-level error;
 *   - **`P2010`** — Prisma's "raw query failed", which is what a violation
 *     inside `$executeRaw` becomes. The real code is only in the message, so a
 *     check that looks at `code` alone treats a name collision during a move as
 *     an unknown server error.
 */
export function isUniqueViolation(cause: unknown): boolean {
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    if (cause.code === 'P2002') return true;
    if (cause.code === 'P2010') return mentionsUniqueViolation(cause.message);
  }

  if (typeof cause === 'object' && cause !== null) {
    const code = (cause as { code?: string }).code;
    if (code === '23505') return true;
    if (code === 'P2010') return mentionsUniqueViolation(String((cause as { message?: string }).message ?? ''));
  }

  return false;
}

function mentionsUniqueViolation(message: string): boolean {
  return message.includes('23505') || /duplicate key value/i.test(message);
}
