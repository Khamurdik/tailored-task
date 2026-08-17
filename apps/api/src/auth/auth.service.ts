import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginResponse, SessionUser } from '@dataroom/shared';

import { APP_CONFIG, AppError, EventBus, type AppConfig } from '../common';
import { UsersService, type User } from '../users';
import { GoogleIdentityService } from './google-identity.service';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { RefreshTokenRepository } from './refresh-token.repository';

/** Parsed from `JWT_REFRESH_TTL` / `JWT_ACCESS_TTL` — `1d`, `7d`, `15m`, `30s`. */
function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (match === null) throw new Error(`Cannot parse a duration from "${value}"`);

  const amount = Number(match[1]);
  const unit = match[2];
  const scale = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * scale;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly google: GoogleIdentityService,
    private readonly events: EventBus,
  ) {}

  /**
   * One response for every credential failure.
   *
   * Wrong password, unknown email, and an account with no password set are
   * byte-identical, because splitting them hands a caller an oracle for which
   * addresses are provisioned — in a product whose whole point is that the guest
   * list is confidential.
   */
  private failed(): AppError {
    return AppError.unauthenticated();
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const user = await this.users.findByEmail(email);

    if (user === null) {
      // Burn the same time as a real verification before refusing. Without this,
      // "no such user" returns in microseconds and "wrong password" in ~50ms,
      // and the difference is a reliable oracle (API-AUTH-005).
      await verifyAgainstDummy(password);
      throw this.failed();
    }

    // `verifyPassword` handles a null hash by spending the same time and then
    // refusing — a Google-only account must not be a fast "no", and must never
    // be a "yes" (API-AUTH-004).
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) throw this.failed();

    return this.issueSession(user);
  }

  /**
   * Google sign-in **links to an existing account and never creates one.**
   *
   * That single rule is what keeps a public OAuth button from being a public
   * signup form, and it is why every failure here is the same generic one.
   */
  async loginWithGoogle(idToken: string): Promise<LoginResponse> {
    const identity = await this.google.verify(idToken);
    if (identity === null) throw this.failed();

    // `google_sub` first. A person can change the email on their Google account,
    // and `sub` is the only stable identifier — matching on email alone would
    // lose the link (API-AUTH-022).
    const bySub = await this.users.findByGoogleSub(identity.sub);
    if (bySub !== null) return this.issueSession(bySub);

    const byEmail = await this.users.findByEmail(identity.email);
    // No matching row is the same generic failure, and **no user is created**.
    // API-AUTH-016 asserts the row count is unchanged, because the failure this
    // guards against is a helpful upsert.
    if (byEmail === null) throw this.failed();

    // First Google login for this account: remember the subject so later logins
    // match on it.
    const linked = await this.users.linkGoogleSub(byEmail.id, identity.sub);
    return this.issueSession(linked);
  }

  /**
   * Rotates the pair, and kills the family on a replay.
   *
   * A presented token that is already revoked means the plaintext was copied —
   * the legitimate holder would be presenting the *current* one. Rotation alone
   * would just refuse it; killing the family is what makes theft
   * **detectable and contained** after the fact. It is detection, not
   * prevention: the copy already happened.
   */
  async refresh(presented: string): Promise<LoginResponse> {
    const outcome = await this.refreshTokens.classify(presented);

    if (outcome.kind === 'reused') {
      await this.refreshTokens.revokeFamily(outcome.row.familyId);
      throw this.failed();
    }
    if (outcome.kind === 'unknown') throw this.failed();

    const user = await this.users.findById(outcome.row.userId);
    if (user === null) throw this.failed();

    // The old token dies before the new one is handed out, so a crash between
    // the two leaves the client with nothing rather than with two live tokens.
    await this.refreshTokens.revoke(outcome.row.id);
    return this.issueSession(user, outcome.row.familyId, { emitEvent: false });
  }

  /**
   * Revokes the family **server-side**.
   *
   * Clearing `localStorage` is not a logout: the refresh family would stay alive
   * and anyone holding a copy could mint access tokens for another seven days.
   * Unknown tokens are accepted silently — a logout must never fail, and
   * refusing one would tell the caller whether the token was real.
   */
  async logout(presented: string): Promise<void> {
    const outcome = await this.refreshTokens.classify(presented);
    if (outcome.kind === 'unknown') return;
    await this.refreshTokens.revokeFamily(outcome.row.familyId);
  }

  async sessionUserFor(userId: string): Promise<SessionUser | null> {
    const user = await this.users.findById(userId);
    return user === null ? null : toSessionUser(user);
  }

  verifyAccessToken(token: string): { userId: string } | null {
    try {
      const payload = this.jwt.verify<{ sub?: string }>(token, {
        secret: this.config.auth.accessSecret,
      });
      return typeof payload.sub === 'string' ? { userId: payload.sub } : null;
    } catch {
      // Expired, malformed, wrong signature — all the same to a caller. The
      // guard turns null into "anonymous", never into a 401.
      return null;
    }
  }

  /** Exposed so the seeder and tests share one definition of the parameters. */
  async hash(plaintext: string): Promise<string> {
    return hashPassword(plaintext);
  }

  private async issueSession(
    user: User,
    familyId?: string,
    options: { emitEvent?: boolean } = {},
  ): Promise<LoginResponse> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id },
      {
        secret: this.config.auth.accessSecret,
        // Seconds, not the `"1d"` string. `expiresIn` is typed against `ms`'s
        // branded `StringValue`, so a plain `string` from config does not fit —
        // and converting through the parser this module already has means the
        // format is validated in one place rather than twice.
        expiresIn: Math.floor(durationToMs(this.config.auth.accessTtl) / 1000),
      },
    );

    const refresh = await this.refreshTokens.issue(
      user.id,
      durationToMs(this.config.auth.refreshTtl),
      familyId,
    );

    /**
     * `user.authenticated`, emitted on every successful login.
     *
     * `sharing` listens to bind pending email-addressed grants. Since
     * `user.created` turned out to be undeliverable — the seeder is a separate
     * process — this is the **only** binding trigger rather than a fast path in
     * front of one. Emitting rather than calling keeps this module below
     * `sharing` in the layer graph.
     *
     * Not emitted on refresh: a rotation is not a login, and re-running the
     * claim on every token refresh would be pointless work.
     */
    if (options.emitEvent !== false) {
      this.events.emit('user.authenticated', { userId: user.id, email: user.email });
    }

    return { accessToken, refreshToken: refresh.token, user: toSessionUser(user) };
  }
}

function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin };
}

export { durationToMs };
