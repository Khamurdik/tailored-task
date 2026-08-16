import { z } from 'zod';

/**
 * Every error the API can emit. The client switches on `code`, never on
 * `message` — messages are for humans and are allowed to change.
 *
 * One code covers every login failure. Splitting it into `BAD_PASSWORD` and
 * `NO_SUCH_USER` would hand the client an email oracle the API is deliberately
 * built to withhold.
 */
export const ErrorCodeSchema = z.enum([
  'NAME_CONFLICT',
  'GONE',
  'CYCLIC_MOVE',
  'DEPTH_LIMIT',
  'FILE_TOO_LARGE',
  'UNSUPPORTED_FILE_TYPE',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'CONFLICT',
  'VALIDATION_FAILED',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Every error leaving the API has this shape. No raw Postgres strings. */
export const ApiErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
