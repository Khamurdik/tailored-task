import { ApiErrorSchema, type ErrorCode } from '@dataroom/shared';
import { AxiosError } from 'axios';

/**
 * Every failure the UI can see, as one type.
 *
 * The point is that a component branches on `code`, which it compiles against,
 * rather than on a status number or a message string. Messages are for humans
 * and are allowed to change; codes are the contract.
 */
export type AppErrorKind = 'api' | 'network' | 'timeout' | 'unknown';

export class AppError extends Error {
  constructor(
    kind: AppErrorKind,
    code: ErrorCode,
    message: string,
    status: number | null,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
    this.code = code;
    this.status = status;
    this.details = details;
  }

  readonly kind: AppErrorKind;
  readonly code: ErrorCode;
  readonly status: number | null;
  readonly details: Record<string, unknown> | undefined;

  /**
   * Whether trying again could plausibly work.
   *
   * A timeout and a dropped connection are worth a retry button; a 404 is not,
   * and offering one there is how a user ends up hammering a resource that is
   * gone. `RATE_LIMITED` is retryable in principle, but only after a wait, so
   * the recovery copy says so rather than the button implying "now".
   */
  get retryable(): boolean {
    if (this.kind === 'network' || this.kind === 'timeout') return true;
    return this.code === 'RATE_LIMITED' || this.code === 'INTERNAL';
  }

  get suggestedName(): string | undefined {
    const value = this.details?.['suggestedName'];
    return typeof value === 'string' ? value : undefined;
  }
}

/**
 * Turns anything a request can reject with into an `AppError`.
 *
 * Three cases the naive version gets wrong, and each is a declared test:
 *
 *   - **a 500 whose body is not the envelope.** A proxy timeout page, an HTML
 *     error from a CDN, an empty body — none of them parse, and all of them
 *     must still produce a usable error rather than a `TypeError` while
 *     reading `.code` of undefined;
 *   - **no response at all**, which is a network failure and reads completely
 *     differently to a user than a server error does;
 *   - **a timeout**, which axios reports as an error with no response and a
 *     specific code, and which is the one case where "try again" is honest.
 */
export function toAppError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;

  if (cause instanceof AxiosError) {
    if (cause.code === AxiosError.ETIMEDOUT || cause.code === 'ECONNABORTED') {
      return new AppError('timeout', 'INTERNAL', 'The request took too long', null);
    }

    if (cause.response === undefined) {
      return new AppError('network', 'INTERNAL', 'Could not reach the server', null);
    }

    const parsed = ApiErrorSchema.safeParse(cause.response.data);
    if (parsed.success) {
      return new AppError(
        'api',
        parsed.data.code,
        parsed.data.message,
        cause.response.status,
        parsed.data.details,
      );
    }

    // A response that is not the envelope. The status is still meaningful, and
    // the body deliberately is not read — an HTML error page or a raw server
    // string rendered to a user is both useless and a small information leak.
    return new AppError(
      'api',
      statusToCode(cause.response.status),
      'Something went wrong',
      cause.response.status,
    );
  }

  return new AppError('unknown', 'INTERNAL', 'Something went wrong', null);
}

function statusToCode(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHENTICATED';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 410:
      return 'GONE';
    case 413:
      return 'FILE_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_FILE_TYPE';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL';
  }
}
