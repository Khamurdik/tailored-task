import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { UsersModule } from '../users';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleIdentityService } from './google-identity.service';
import { RefreshTokenRepository } from './refresh-token.repository';
import { SessionGuard } from './session.guard';

/**
 * L2. Identity only — never authorization.
 *
 * `JwtModule.register({})` with no secret on purpose: the secret is passed per
 * call from `APP_CONFIG`, so there is exactly one place it is read and no chance
 * of a module-level default silently signing with the wrong key.
 *
 * Does not import `access`. The moment this module reads a share grant, the
 * authn/authz boundary is gone.
 */
@Module({
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenRepository, GoogleIdentityService, SessionGuard],
  exports: [AuthService, SessionGuard, RefreshTokenRepository],
})
export class AuthModule {}
