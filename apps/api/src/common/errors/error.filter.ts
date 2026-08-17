import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  type HttpExceptionBody,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiError, ErrorCode } from '@dataroom/shared';
import type { Response } from 'express';

import { AppError } from './app-error';

/**
 * The single exit for every error. Nothing leaves this API without a `code`
 * from the shared union, and no raw Postgres string reaches a client.
 *
 * That second rule is not tidiness. A constraint-violation message names the
 * table, the column, and often the offending value — a small schema leak on
 * every duplicate name.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.translate(exception);

    if (status >= 500) {
      // The stack stays here. What the client gets is the envelope below.
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      return { status: exception.status, body: exception.toEnvelope() };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Anything unrecognised is a bug in this service, and the client gets one
    // sentence about it. Details are in the log line above.
    return {
      status: 500,
      body: { code: 'INTERNAL', message: 'Something went wrong' },
    };
  }

  /**
   * Only the two codes with a genuine meaning at the API surface are mapped.
   * Everything else Prisma can raise is a bug here, not a condition a client
   * can act on, so it takes the 500 path rather than being dressed up as a 4xx.
   */
  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    body: ApiError;
  } {
    switch (exception.code) {
      case 'P2002':
        // The suggested name is filled in by whichever service caught the
        // conflict and knows the sibling set; reaching this filter means
        // nobody did, so the client gets the code without the hint.
        return {
          status: 409,
          body: { code: 'NAME_CONFLICT', message: 'A sibling with that name already exists' },
        };
      case 'P2025':
        return { status: 404, body: { code: 'NOT_FOUND', message: 'Not found' } };
      default:
        this.logger.error(`Unmapped Prisma error ${exception.code}`, exception.stack);
        return { status: 500, body: { code: 'INTERNAL', message: 'Something went wrong' } };
    }
  }

  private fromHttpException(exception: HttpException): { status: number; body: ApiError } {
    const status = exception.getStatus();
    const response = exception.getResponse();

    // A `ValidationPipe` rejection arrives as an HttpException whose body is
    // `{ message: string[] }`. Those strings are ours — they come from zod —
    // so they are safe to pass through, and they are the only useful thing a
    // client can act on for a 400.
    const details =
      typeof response === 'object' && response !== null && 'message' in response
        ? { issues: (response as HttpExceptionBody).message }
        : undefined;

    const body: ApiError = {
      code: statusToCode(status),
      message: exception.message,
      ...(status === 400 && details !== undefined ? { details } : {}),
    };

    return { status, body };
  }
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
      return status >= 500 ? 'INTERNAL' : 'CONFLICT';
  }
}
