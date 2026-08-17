import { Injectable } from '@nestjs/common';

import type { User } from './user.types';
import { UsersRepository } from './users.repository';

/**
 * User lookup. No opinion about how identity is proven — that is `auth`.
 *
 * This module never sees a plaintext password: hashing lives in `auth`, and the
 * seeder calls that helper directly rather than going through here.
 *
 * There is no `create`, and there will not be one. Provisioning happens through
 * the seeder, and the missing method is what makes "no HTTP request in this
 * system creates a user" enforceable rather than merely intended.
 */
@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async findById(id: string): Promise<User | null> {
    return this.users.findById(id);
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    return this.users.findByGoogleSub(googleSub);
  }

  /** Called by `auth` on a first successful Google login, never by a controller. */
  async linkGoogleSub(userId: string, googleSub: string): Promise<User> {
    return this.users.linkGoogleSub(userId, googleSub);
  }
}
