import { z } from 'zod';

import { SeedUsersSchema } from './seed-users.schema';

/**
 * The validated environment. Boot crashes on anything missing or malformed,
 * with the variable named — a service that starts and then fails on the first
 * request is strictly worse than one that refuses to start.
 *
 * There is no cookie secret and no CSRF secret. This API sets no cookies.
 */

const commaList = z
  .string()
  .transform((raw) => raw.split(',').map((part) => part.trim()).filter(Boolean));

/** `''` is how a `.env` file spells "unset". Treat it as absent, not as a value. */
const blankAsUndefined = z
  .string()
  .transform((value) => (value.trim() === '' ? undefined : value))
  .optional();

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('1d'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  /**
   * Validated here as well as in the seeder so a malformed value fails at boot
   * rather than at the first `db:seed`. Both go through the same schema; the
   * one thing that must never happen is the two disagreeing about the format.
   */
  SEED_USERS: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        return SeedUsersSchema.parse(JSON.parse(raw));
      } catch (cause) {
        ctx.addIssue({
          code: 'custom',
          message: `SEED_USERS must be a JSON array of { email, password, name, admin? }: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        });
        return z.NEVER;
      }
    }),
  SEED_FORCE_RESET: booleanish.default(false),

  /** Optional. Unset means the Google button is not rendered and login is password-only. */
  GOOGLE_CLIENT_ID: blankAsUndefined,

  JOBS_SCHEDULER_ENABLED: booleanish.default(true),
  JOBS_DISABLED: commaList.default([]),

  /**
   * Defaults to the restrictive value, so an unconfigured deployment is the
   * safe one. Note that `Content-Disposition` does not participate in this
   * toggle — only `application/pdf` is ever served inline, under either value.
   */
  UPLOAD_FILE_POLICY: z.enum(['pdf-only', 'all-files']).default('pdf-only'),

  AWS_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  AWS_ACCESS_KEY_ID: blankAsUndefined,
  AWS_SECRET_ACCESS_KEY: blankAsUndefined,
  S3_PRESIGN_GET_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  CORS_ORIGINS: commaList.default([]),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Cron overrides arrive as `JOBS_CRON_<ID>` with the id upper-snake-cased, so
 * they cannot be listed in a fixed schema without duplicating the job registry
 * into `common` — which would put domain knowledge in L0. They are collected
 * by prefix instead and validated by `jobs`, which is the module that knows
 * which ids exist.
 */
export function collectCronOverrides(source: NodeJS.ProcessEnv): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith('JOBS_CRON_') && value !== undefined && value.trim() !== '') {
      overrides[key.slice('JOBS_CRON_'.length).toLowerCase().replaceAll('_', '-')] = value.trim();
    }
  }
  return overrides;
}
