import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../common';
import { AuthService } from './auth.service';

export const REQUIRE_AUTH = 'auth:required';

/** For routes that need a real user. Everything else is anonymous-tolerant. */
export function RequireAuth(): CustomDecorator<string> {
  return SetMetadata(REQUIRE_AUTH, true);
}

/**
 * Who is calling, as `auth` can determine it **without reading a share grant**.
 *
 * `{ shareToken }` carries the raw credential, not a resolved grant id. That is
 * the authn/authz boundary: the moment this module looked a token up in
 * `shares`, `auth` would depend on `access` and the split between "who is this"
 * and "what may they do" would be gone. `NodeAccessGuard` does the resolution.
 */
export type RequestActor = { userId: string } | { shareToken: string } | null;

/** `@Actor()` — the resolved actor, or null. */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  return context.switchToHttp().getRequest<Request>().actor ?? null;
});

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  /**
   * **Never throws on a missing token.**
   *
   * The same endpoint serves an owner with a JWT and an anonymous visitor with
   * `X-Share-Token`, so "no credential" is a normal outcome and `null` is a
   * legitimate actor. Routes that genuinely need a user opt in with
   * `@RequireAuth()`. A guard that 401'd by default would make every share route
   * an exception, and exceptions are what get forgotten.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    request.actor = await this.resolve(request);

    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_AUTH, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === true && (request.actor === null || !('userId' in request.actor))) {
      // 401 here rather than 404: this is authentication, not authorization. The
      // route's existence is not a secret — the caller simply has no session, and
      // telling them so is what lets the client refresh and retry.
      throw AppError.unauthenticated();
    }

    return true;
  }

  private async resolve(request: Request): Promise<RequestActor> {
    /**
     * A share credential wins over a bearer token when both are present.
     *
     * Deliberate, and it matches the client, which sends exactly one. If both
     * arrive it means something is confused, and resolving the *narrower*
     * credential is the safe reading — treating a signed-in owner's request as
     * an owner request while they are looking at someone's share link is how a
     * public page starts rendering owner-scoped data.
     */
    const shareToken = header(request, 'x-share-token');
    if (shareToken !== null) return { shareToken };

    const authorization = header(request, 'authorization');
    if (authorization === null || !authorization.startsWith('Bearer ')) return null;

    return this.auth.verifyAccessToken(authorization.slice('Bearer '.length).trim());
  }
}

function header(request: Request, name: string): string | null {
  const raw = request.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.trim() === '' ? null : value.trim();
}
