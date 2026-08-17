import { z } from 'zod';

import { collectCronOverrides, EnvSchema, type Env } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  readonly env: Env['NODE_ENV'];
  readonly isProduction: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly auth: {
    readonly accessSecret: string;
    readonly refreshSecret: string;
    readonly accessTtl: string;
    readonly refreshTtl: string;
    /** Undefined disables Google sign-in entirely, which is a supported setup. */
    readonly googleClientId: string | undefined;
  };
  readonly seed: {
    readonly users: Env['SEED_USERS'];
    readonly forceReset: boolean;
  };
  readonly jobs: {
    readonly schedulerEnabled: boolean;
    readonly disabled: readonly string[];
    readonly cronOverrides: Readonly<Record<string, string>>;
  };
  readonly uploads: {
    readonly policy: Env['UPLOAD_FILE_POLICY'];
  };
  readonly s3: {
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string | undefined;
    readonly secretAccessKey: string | undefined;
    readonly presignGetTtlSeconds: number;
  };
  readonly corsOrigins: readonly string[];
}

/**
 * Turns `process.env` into `AppConfig`, or throws with every problem listed at
 * once.
 *
 * Reporting all of them together is the point. A schema that throws on the
 * first failure turns configuring a fresh environment into a guessing game of
 * one variable per restart.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(
      [
        'Invalid environment. The API will not start until these are fixed:',
        ...problemsOf(parsed.error),
        '',
        'See apps/api/.env.example for the full list, and DEPLOYMENT.md §2.',
      ].join('\n'),
    );
  }

  const env = parsed.data;

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshTtl: env.JWT_REFRESH_TTL,
      googleClientId: env.GOOGLE_CLIENT_ID,
    },
    seed: {
      users: env.SEED_USERS,
      forceReset: env.SEED_FORCE_RESET,
    },
    jobs: {
      schedulerEnabled: env.JOBS_SCHEDULER_ENABLED,
      disabled: env.JOBS_DISABLED,
      cronOverrides: collectCronOverrides(source),
    },
    uploads: { policy: env.UPLOAD_FILE_POLICY },
    s3: {
      region: env.AWS_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      presignGetTtlSeconds: env.S3_PRESIGN_GET_TTL_SECONDS,
    },
    corsOrigins: env.CORS_ORIGINS,
  };
}

/**
 * Never echo the value — several of these are secrets, and a boot log is the
 * least private place in a deployment. The variable name and the reason are
 * enough to fix it.
 */
function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  ${name}: ${issue.message}`;
  });
}
