import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppError, normalizeName, sanitizeName, suggestConflictName } from '../common';
import { NodesRepository } from './nodes.repository';

/** The widest window of candidate names a single retry will consider. */
const MAX_SPREAD = 256;

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
   *
   * ## Why later attempts pick a *random* free name rather than the lowest
   *
   * The obvious implementation — always the lowest free suffix — is a thundering
   * herd. Twenty simultaneous uploads of `report.pdf` all read the same sibling
   * set, all compute `report (1).pdf`, one wins, and the other nineteen retry
   * and immediately collide again on `report (2).pdf`. The retry cap is ten, so
   * under twenty-way contention a request can lose ten races in a row and the
   * user gets a 409 on an upload that should simply have been renamed.
   *
   * That was not theoretical: `nodes/TODO.md` specifies the cap of ten and
   * `files/TODO.md`'s acceptance bar is "20 files drag-dropped at once all
   * land", and the two cannot both be true with deterministic candidates.
   * `API-FILES-017` is where they met.
   *
   * So the first two attempts stay deterministic — with no contention, which is
   * every ordinary upload, `report.pdf` is followed by `report (1).pdf` and the
   * numbering is the tidy one a user expects. From the third attempt the
   * candidate is drawn from a widening window of free names, which turns
   * lockstep collision into a birthday problem over a space that doubles each
   * round and converges in two or three.
   *
   * The cost is honest: under heavy contention the numbering has gaps —
   * `report (7).pdf` may exist while `(3)` is free. Gap-free numbering under
   * concurrency requires serializing every upload into one folder, which is a
   * far worse trade than an occasional skipped number.
   */
  async nextFreeName(
    requested: string,
    parentId: string | null,
    ownerId: string,
    alsoTaken: readonly string[] = [],
    attempt = 0,
  ): Promise<string> {
    const siblings = await this.nodes.liveSiblingNames(parentId, ownerId);
    const taken = new Set([...siblings, ...alsoTaken]);

    if (attempt < 2) return suggestConflictName(requested, taken);

    // Doubling each round, capped so a pathological folder cannot make this
    // walk thousands of candidates per attempt.
    const window = Math.min(2 ** attempt, MAX_SPREAD);

    const candidates: string[] = [];
    const scratch = new Set(taken);
    for (let index = 0; index < window; index += 1) {
      const candidate = suggestConflictName(requested, scratch);
      candidates.push(candidate);
      // Added so the next iteration yields the *following* free name rather
      // than the same one.
      scratch.add(candidate);
    }

    return candidates[randomInt(candidates.length)] ?? candidates[0] ?? requested;
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
