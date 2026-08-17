import { hkdfSync } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { decodeCursor, encodeCursor, type CursorPayload } from './cursor';

/**
 * Cursors, with the signing key wired in.
 *
 * The key is **derived** from the refresh secret rather than being the refresh
 * secret. They are unrelated jobs, and reusing one key for two purposes means a
 * future change to either — a rotation, an algorithm swap — silently changes
 * the other. HKDF with a distinct label costs one line and removes the
 * question.
 *
 * There is deliberately no `CURSOR_SECRET` in `.env`. Another required variable
 * is another way a deployment fails to start, and a derived key needs no
 * coordination when secrets rotate: cursors issued before a rotation stop
 * validating, which is correct — they are page positions, not sessions.
 */
@Injectable()
export class CursorService {
  private readonly key: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(
      hkdfSync('sha256', config.auth.refreshSecret, '', 'dataroom:keyset-cursor:v1', 32),
    ).toString('base64url');
  }

  encode(payload: CursorPayload): string {
    return encodeCursor(payload, this.key);
  }

  /** Throws `InvalidCursorError`. Callers map that to a 400, never to an empty page. */
  decode(cursor: string): CursorPayload {
    return decodeCursor(cursor, this.key);
  }
}
