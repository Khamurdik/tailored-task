import type { ApiError, ErrorCode } from '@dataroom/shared';

/**
 * The one error type that crosses a module boundary. Everything a client sees
 * has a `code` from the shared union, so the client switches on a value it
 * compiles against rather than on a message.
 */
export class AppError extends Error {
  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  toEnvelope(): ApiError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details };
  }

  /**
   * Denial is 404, never 403. A 403 confirms the id exists, which is an
   * enumeration oracle across every room in the system — so a denied request
   * and a nonexistent id must be byte-identical, which they can only be if
   * there is exactly one way to construct both.
   */
  static notFound(): AppError {
    return new AppError('NOT_FOUND', 'Not found', 404);
  }

  static nameConflict(suggestedName: string): AppError {
    return new AppError('NAME_CONFLICT', 'A sibling with that name already exists', 409, {
      suggestedName,
    });
  }

  static gone(): AppError {
    return new AppError('GONE', 'This resource is no longer available', 410);
  }

  static cyclicMove(): AppError {
    return new AppError('CYCLIC_MOVE', 'A node cannot be moved beneath its own descendant', 400);
  }

  static depthLimit(max: number): AppError {
    return new AppError('DEPTH_LIMIT', `The tree may not exceed ${max} levels`, 400, { max });
  }

  static fileTooLarge(max: number): AppError {
    return new AppError('FILE_TOO_LARGE', 'The file exceeds the maximum upload size', 413, { max });
  }

  static unsupportedFileType(): AppError {
    return new AppError('UNSUPPORTED_FILE_TYPE', 'That file type is not accepted', 415);
  }

  static unauthenticated(): AppError {
    return new AppError('UNAUTHENTICATED', 'Authentication required', 401);
  }

  static rateLimited(): AppError {
    return new AppError('RATE_LIMITED', 'Too many requests', 429);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message, 409);
  }

  static validationFailed(details?: Record<string, unknown>): AppError {
    return new AppError('VALIDATION_FAILED', 'The request failed validation', 400, details);
  }
}
