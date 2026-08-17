import { Injectable } from '@nestjs/common';
import type { User as PrismaUser } from '@prisma/client';

import { PrismaService } from '../common';
import type { User } from './user.types';

/**
 * The only code that reads or writes the `users` table.
 *
 * There is no `create`. Provisioning happens through the seeder, out of band —
 * no HTTP request in this system creates a user row, and the absence of a
 * method is a stronger statement of that than a comment would be.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return toDomain(await this.prisma.user.findUnique({ where: { id } }));
  }

  /**
   * Case-insensitivity comes from the `citext` column. NFC normalization does
   * not — `citext` folds case, not Unicode composition — so it happens here,
   * on every lookup, and must happen identically in the seeder. Otherwise a
   * user seeded with a decomposed accented address cannot log in with the
   * composed spelling their keyboard produces.
   */
  async findByEmail(email: string): Promise<User | null> {
    return toDomain(
      await this.prisma.user.findUnique({ where: { email: email.normalize('NFC').trim() } }),
    );
  }

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    return toDomain(await this.prisma.user.findUnique({ where: { googleSub } }));
  }

  /**
   * Called by `auth` on a first successful Google login.
   *
   * The unique constraint on `google_sub` is what enforces "two users cannot
   * claim one Google identity" — it is not checked here, because a check here
   * would be a race and the constraint is not.
   */
  async linkGoogleSub(userId: string, googleSub: string): Promise<User> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { googleSub },
    });
    return toDomain(updated) as User;
  }
}

function toDomain(row: PrismaUser | null): User | null {
  return row === null
    ? null
    : {
        id: row.id,
        email: row.email,
        name: row.name,
        passwordHash: row.passwordHash,
        googleSub: row.googleSub,
        isAdmin: row.isAdmin,
        createdAt: row.createdAt,
      };
}
