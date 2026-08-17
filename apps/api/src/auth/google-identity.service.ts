import { Inject, Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { APP_CONFIG, type AppConfig } from '../common';

export interface GoogleIdentity {
  sub: string;
  email: string;
}

/**
 * Verifies a Google ID token, and refuses everything it cannot vouch for.
 *
 * The module is **optional infrastructure**: with `GOOGLE_CLIENT_ID` unset this
 * service reports itself unconfigured and the endpoint declines, so a checkout
 * with no Google credentials still boots and serves password login
 * (`API-AUTH-026`).
 */
@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);
  private readonly client: OAuth2Client | null;
  private readonly clientId: string | undefined;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.clientId = config.auth.googleClientId;
    this.client = this.clientId === undefined ? null : new OAuth2Client(this.clientId);
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /**
   * Returns the identity, or null. **Never explains why.**
   *
   * Every rejection below collapses to null so `auth` can answer with one
   * indistinguishable failure. Distinguishing "no such account" from "bad token"
   * would turn the Google button into an oracle for which addresses are
   * provisioned — the same leak the password path is built to avoid, arriving
   * through a different door.
   */
  async verify(idToken: string): Promise<GoogleIdentity | null> {
    if (this.client === null || this.clientId === undefined) return null;

    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        // Checked by the library: signature against Google's keys, `exp`, and
        // `aud` against this client id. An expired token and a token minted for
        // a different application both fail here (API-AUTH-018, 020).
        audience: this.clientId,
      });

      const payload = ticket.getPayload();
      if (payload === undefined) return null;

      /**
       * **The single most important line in this module.**
       *
       * Without it, anyone who can obtain a Google token asserting an arbitrary
       * *unverified* email can sign in as that user. Google will happily issue
       * one for an address the account holder has not proven they own.
       */
      if (payload.email_verified !== true) {
        this.logger.warn('Rejected a Google token with email_verified: false');
        return null;
      }

      // Belt and braces over the library's own check. `iss` is the one claim that
      // decides whether this token came from Google at all.
      if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
        return null;
      }

      if (payload.email === undefined || payload.sub === '') return null;

      return { sub: payload.sub, email: payload.email };
    } catch {
      // A malformed token, a bad signature, a wrong audience, an expired token —
      // all one answer. The reason is deliberately not logged at info level: it
      // would be a record of which addresses were tried.
      return null;
    }
  }
}
