import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AuthService, GoogleIdentityService, hashPassword, type GoogleIdentity } from '@api/auth';
import { RefreshTokenRepository } from '@api/auth';
import type { PrismaService } from '@api/common';
import { EventBus } from '@api/common';

import { createTestApp, resetDatabase, type TestApp } from '@support/app';

/**
 * `auth` against the real database.
 *
 * Only one thing is faked: `GoogleIdentityService`, because verifying a token
 * requires Google. Everything else — argon2, the JWT, the refresh table, the
 * event bus — is real, so a test that passes here is a test of the module rather
 * than of its mocks.
 */
let app: TestApp;
let prisma: PrismaService;
let auth: AuthService;
let refreshTokens: RefreshTokenRepository;
let events: EventBus;

/** What the faked verifier will return next. */
let googleAnswer: GoogleIdentity | null = null;

const PASSWORD = 'a-real-password-2026';

beforeAll(async () => {
  app = await createTestApp({
    override: (builder) =>
      builder.overrideProvider(GoogleIdentityService).useValue({
        configured: true,
        verify: () => Promise.resolve(googleAnswer),
      }),
  });
  prisma = app.prisma;
  auth = app.module.get(AuthService);
  refreshTokens = app.module.get(RefreshTokenRepository);
  events = app.module.get(EventBus);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  googleAnswer = null;
});

async function seedUser(
  email: string,
  options: { password?: string | null; name?: string } = {},
): Promise<string> {
  const password = options.password === undefined ? PASSWORD : options.password;
  const user = await prisma.user.create({
    data: {
      email,
      name: options.name ?? 'Ana Ruiz',
      // Hashed with the same helper the seeder uses. Divergence here is silent —
      // it presents as a wrong password — which is why there is one definition.
      passwordHash: password === null ? null : await hashPassword(password),
    },
  });
  return user.id;
}

describe('password sign-in', () => {
  it('API-AUTH-001 a seeded user logs in with email and password', async () => {
    const userId = await seedUser('ana@example.com');

    const session = await auth.login('ana@example.com', PASSWORD);

    expect(session.user).toMatchObject({ id: userId, email: 'ana@example.com', isAdmin: false });
    expect(session.accessToken.split('.')).toHaveLength(3);
    expect(session.refreshToken.length).toBeGreaterThan(20);
  });

  it('API-AUTH-003 wrong password and unknown email return byte-identical responses', async () => {
    await seedUser('ana@example.com');

    const wrongPassword = await auth.login('ana@example.com', 'not-it').catch((c: unknown) => c);
    const unknownEmail = await auth.login('nobody@example.com', 'not-it').catch((c: unknown) => c);

    // Splitting these hands a caller an oracle for which addresses are
    // provisioned — in a product whose whole point is that the guest list is
    // confidential.
    for (const field of ['code', 'status', 'message'] as const) {
      expect((wrongPassword as Record<string, unknown>)[field]).toBe(
        (unknownEmail as Record<string, unknown>)[field],
      );
    }
    expect((wrongPassword as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('API-AUTH-004 a user with a null password_hash fails password login identically', async () => {
    // A Google-only account. It must not be a fast "no", and must never be a
    // "yes" — the bug this guards against is `null === null` reading as a match.
    await seedUser('google-only@example.com', { password: null });

    const nullHash = await auth.login('google-only@example.com', PASSWORD).catch((c: unknown) => c);
    const unknown = await auth.login('nobody@example.com', PASSWORD).catch((c: unknown) => c);

    expect((nullHash as { code: string }).code).toBe((unknown as { code: string }).code);
  });

  it('API-AUTH-005 login timing for unknown email and wrong password stays within one order of magnitude', async () => {
    await seedUser('ana@example.com');

    const sample = async (email: string): Promise<number> => {
      const started = performance.now();
      await auth.login(email, 'wrong-password').catch(() => undefined);
      return performance.now() - started;
    };

    // Ten rather than fifty: argon2 at 19 MiB is deliberately expensive, and the
    // property is a ratio rather than a precise figure. Medians, because a single
    // GC pause in a fifty-sample run is enough to fail a mean.
    const unknown: number[] = [];
    const wrong: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      unknown.push(await sample('nobody@example.com'));
      wrong.push(await sample('ana@example.com'));
    }

    const median = (values: number[]): number => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };

    const ratio = median(unknown) / median(wrong);
    // Without the dummy verification, "no such user" returns in microseconds and
    // "wrong password" in tens of milliseconds — a ratio near zero and a reliable
    // oracle.
    expect(ratio, `unknown ${median(unknown)}ms vs wrong ${median(wrong)}ms`).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(10);
  }, 60_000);
});

describe('tokens and sessions', () => {
  it('API-AUTH-007 refresh rotates the pair and the old refresh token stops working', async () => {
    await seedUser('ana@example.com');
    const first = await auth.login('ana@example.com', PASSWORD);

    const second = await auth.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(auth.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('API-AUTH-008 replaying a rotated refresh token invalidates the whole family', async () => {
    await seedUser('ana@example.com');
    const first = await auth.login('ana@example.com', PASSWORD);
    const second = await auth.refresh(first.refreshToken);

    // The replay. The legitimate holder would be presenting `second`, so seeing
    // `first` again means the plaintext was copied.
    await expect(auth.refresh(first.refreshToken)).rejects.toBeDefined();

    // Detection, not prevention — the copy already happened. What this buys is
    // that the thief and the victim both lose the session rather than the thief
    // keeping it quietly.
    await expect(auth.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('API-AUTH-009 logout revokes the family server-side, not just on the client', async () => {
    await seedUser('ana@example.com');
    const session = await auth.login('ana@example.com', PASSWORD);

    await auth.logout(session.refreshToken);

    // Clearing localStorage would leave this working for another seven days.
    await expect(auth.refresh(session.refreshToken)).rejects.toBeDefined();

    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('API-AUTH-010 the stored refresh token is a hash, never the token itself', async () => {
    await seedUser('ana@example.com');
    const session = await auth.login('ana@example.com', PASSWORD);

    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);

    const stored = rows[0]?.tokenHash ?? '';
    expect(stored).not.toBe(session.refreshToken);
    expect(stored).toBe(refreshTokens.hash(session.refreshToken));
    // 64 hex characters. A column holding the plaintext would be ~43 base64url.
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('API-AUTH-027 an expired refresh token is refused without killing the family', async () => {
    await seedUser('ana@example.com');
    const session = await auth.login('ana@example.com', PASSWORD);

    await prisma.refreshToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(auth.refresh(session.refreshToken)).rejects.toBeDefined();

    // Expiry is not a replay. Nobody did anything wrong — the session simply
    // ended — so treating it as theft would revoke families on every idle user.
    const rows = await prisma.refreshToken.findMany();
    expect(rows[0]?.revokedAt).toBeNull();
  });

  it('API-AUTH-006 a valid access token verifies, and a tampered one does not', async () => {
    const userId = await seedUser('ana@example.com');
    const session = await auth.login('ana@example.com', PASSWORD);

    expect(auth.verifyAccessToken(session.accessToken)).toEqual({ userId });

    const [header, payload, signature = ''] = session.accessToken.split('.');
    const tampered = `${header}.${payload}.${signature.slice(0, -2)}xy`;
    // Null, not a throw. The guard turns null into "anonymous" rather than a 401,
    // because an anonymous caller is legitimate.
    expect(auth.verifyAccessToken(tampered)).toBeNull();
    expect(auth.verifyAccessToken('not-a-jwt')).toBeNull();
  });
});

describe('google sign-in and account linking', () => {
  it('API-AUTH-015 google login succeeds for a seeded user whose verified email matches', async () => {
    const userId = await seedUser('ana@example.com');
    googleAnswer = { sub: 'google-sub-1', email: 'ana@example.com' };

    const session = await auth.loginWithGoogle('any-token');

    expect(session.user.id).toBe(userId);
  });

  it('API-AUTH-016 google login for an unknown email fails and creates no user row', async () => {
    await seedUser('ana@example.com');
    const before = await prisma.user.count();
    googleAnswer = { sub: 'google-sub-2', email: 'stranger@example.com' };

    await expect(auth.loginWithGoogle('any-token')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    // The row count, not merely the error. The failure this guards against is a
    // helpful upsert turning a public OAuth button into a public signup form.
    expect(await prisma.user.count()).toBe(before);
  });

  it('API-AUTH-017 a rejected Google token produces the same failure as a bad password', async () => {
    await seedUser('ana@example.com');
    // The verifier returns null for `email_verified: false`, a wrong `aud`, a
    // wrong issuer, and an expired token alike — it never explains which.
    googleAnswer = null;

    const google = await auth.loginWithGoogle('unverified-token').catch((c: unknown) => c);
    const password = await auth.login('ana@example.com', 'wrong').catch((c: unknown) => c);

    expect((google as { code: string }).code).toBe((password as { code: string }).code);
  });

  it('API-AUTH-021 first Google login stores google_sub on the user row', async () => {
    const userId = await seedUser('ana@example.com');
    googleAnswer = { sub: 'google-sub-3', email: 'ana@example.com' };

    await auth.loginWithGoogle('any-token');

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.googleSub).toBe('google-sub-3');
  });

  it('API-AUTH-022 after the Google account email changes, google_sub still matches the same user', async () => {
    const userId = await seedUser('ana@example.com');
    googleAnswer = { sub: 'google-sub-4', email: 'ana@example.com' };
    await auth.loginWithGoogle('any-token');

    // Same person, new address on their Google account, and no row in this system
    // matching it. `sub` is the only stable identifier — matching on email alone
    // would lose the link and fail a legitimate login.
    googleAnswer = { sub: 'google-sub-4', email: 'ana.ruiz@newdomain.example' };
    const session = await auth.loginWithGoogle('any-token');

    expect(session.user.id).toBe(userId);
  });

  it('API-AUTH-023 a password user and a Google login resolve to the same userId', async () => {
    const userId = await seedUser('ana@example.com');

    const byPassword = await auth.login('ana@example.com', PASSWORD);
    googleAnswer = { sub: 'google-sub-5', email: 'ana@example.com' };
    const byGoogle = await auth.loginWithGoogle('any-token');

    // One account, two ways in. Google *links*; it never creates a second row.
    expect(byPassword.user.id).toBe(userId);
    expect(byGoogle.user.id).toBe(userId);
    expect(await prisma.user.count()).toBe(1);
  });
});

describe('events', () => {
  it('API-AUTH-025 user.authenticated is emitted on every successful login', async () => {
    const userId = await seedUser('ana@example.com');
    const seen: { userId: string; email: string }[] = [];
    events.on('user.authenticated', (payload) => {
      seen.push(payload);
    });

    await auth.login('ana@example.com', PASSWORD);
    googleAnswer = { sub: 'google-sub-6', email: 'ana@example.com' };
    await auth.loginWithGoogle('any-token');

    // Both paths. `sharing` binds pending email grants from this, and since
    // `user.created` turned out undeliverable it is the only trigger there is —
    // so a login path that forgot to emit would leave grants pending forever.
    await new Promise((done) => setTimeout(done, 10));
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ userId, email: 'ana@example.com' });
  });

  it('API-AUTH-028 a refresh does not emit user.authenticated', async () => {
    await seedUser('ana@example.com');
    const session = await auth.login('ana@example.com', PASSWORD);

    const seen: unknown[] = [];
    events.on('user.authenticated', (payload) => {
      seen.push(payload);
    });
    await auth.refresh(session.refreshToken);

    // A rotation is not a login. Re-running the pending-grant claim on every
    // token refresh would be pointless work on the hot path.
    await new Promise((done) => setTimeout(done, 10));
    expect(seen).toEqual([]);
  });
});
