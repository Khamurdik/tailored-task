import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  GoogleLoginRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  type LoginResponse,
  type SessionUser,
} from '@dataroom/shared';

import { AppError, type RequestActor } from '../common';
import { AuthService } from './auth.service';
import { Actor, RequireAuth, SessionGuard } from './session.guard';

/**
 * **There is no `POST /auth/register`.** The route does not exist, so the router
 * answers 404 — which is what `API-AUTH-002` asserts. Accounts are provisioned
 * out of band; see `users/TODO.md`.
 *
 * Nothing here sets a cookie. Credentials travel in the `Authorization` header
 * and the refresh token in a request body, which is what removes CSRF as a
 * category (`API-AUTH-011`).
 */
@Controller('auth')
@UseGuards(SessionGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Throttled by IP **and** by email.
   *
   * Per-IP alone lets a botnet spread attempts across one account, which is the
   * shape a real credential-stuffing run takes. The email key is what makes
   * "one account under attack" visible regardless of how many hosts are trying.
   */
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = LoginRequestSchema.safeParse(body);
    // The same failure as bad credentials, not a 400. A validation error here
    // would tell a caller their guess had the wrong shape, and the response for
    // a malformed body should not differ from the response for a wrong password.
    if (!parsed.success) throw AppError.unauthenticated();

    return this.auth.login(parsed.data.email, parsed.data.password);
  }

  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async google(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = GoogleLoginRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.unauthenticated();

    return this.auth.loginWithGoogle(parsed.data.idToken);
  }

  /**
   * The refresh token arrives in the **body**, never a query parameter.
   *
   * A token in a URL lands in browser history, in a `Referer` header, and in
   * every access log between the client and here. `API-AUTH-012` asserts the
   * query-parameter form is rejected — which it is, because the body is the only
   * thing read.
   */
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Body() body: unknown): Promise<LoginResponse> {
    const parsed = RefreshRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.unauthenticated();

    return this.auth.refresh(parsed.data.refreshToken);
  }

  /**
   * 204 whatever happens, and deliberately **not** `@RequireAuth()`.
   *
   * Someone whose access token has already expired still needs to be able to log
   * out — that is precisely when they most need the family revoked. Requiring a
   * live session here would leave the refresh family alive for exactly the people
   * most likely to have lost control of it.
   */
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() body: unknown): Promise<void> {
    const parsed = RefreshRequestSchema.safeParse(body);
    if (!parsed.success) return;
    await this.auth.logout(parsed.data.refreshToken);
  }

  @Get('me')
  @RequireAuth()
  async me(@Actor() actor: RequestActor): Promise<SessionUser> {
    // `@RequireAuth()` has already guaranteed a user actor; this narrows the type
    // rather than re-checking a decision the guard made.
    if (actor === null || !('userId' in actor)) throw AppError.unauthenticated();

    const user = await this.auth.sessionUserFor(actor.userId);
    if (user === null) throw AppError.unauthenticated();
    return user;
  }
}
