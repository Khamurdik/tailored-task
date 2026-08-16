import { z } from 'zod';

/**
 * There is no register schema, and its absence is a contract term rather than
 * an omission — see `CONTRACT-006`. Accounts are provisioned from `.env` by
 * the seeder; nothing on the wire creates a user.
 */
export const LoginRequestSchema = z.strictObject({
  email: z.email(),
  password: z.string().min(1).max(1024),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleLoginRequestSchema = z.strictObject({
  idToken: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;

/** The refresh token travels in the body. Nothing here reads or writes a cookie. */
export const RefreshRequestSchema = z.strictObject({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = RefreshRequestSchema;
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const TokenPairSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
export type TokenPair = z.infer<typeof TokenPairSchema>;

export const SessionUserSchema = z.strictObject({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  isAdmin: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const LoginResponseSchema = TokenPairSchema.extend({
  user: SessionUserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
