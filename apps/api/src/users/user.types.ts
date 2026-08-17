/**
 * The domain type. Deliberately not the Prisma model.
 *
 * `passwordHash` is present because `auth` needs it, and it is the reason
 * nothing outside this module and `auth` should ever hold a `User` — the
 * shared `SessionUser` is what crosses the wire.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  googleSub: string | null;
  isAdmin: boolean;
  createdAt: Date;
}
