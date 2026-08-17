import { ErrorCodeSchema, NodeSummarySchema } from '@dataroom/shared';
import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { createApiClient } from '@web/shared/api/client';
import { request } from '@web/shared/api/request';
import { AppError, toAppError } from '@web/shared/errors/app-error';
import { describe as describeError, errorMessages } from '@web/shared/errors/messages';

function axiosErrorWith(status: number, data: unknown): AxiosError {
  const config = { url: '/nodes', headers: new AxiosHeaders() } as AxiosResponse['config'];
  const response: AxiosResponse = {
    data,
    status,
    statusText: String(status),
    headers: new AxiosHeaders(),
    config,
  };
  return new AxiosError('failed', String(status), config, null, response);
}

describe('turning failures into something a user can act on', () => {
  it('WEB-SHARED-010 the error envelope unwraps into a typed AppError with its code', () => {
    const error = toAppError(
      axiosErrorWith(409, {
        code: 'NAME_CONFLICT',
        message: 'A sibling with that name already exists',
        details: { suggestedName: 'Report (1).pdf' },
      }),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('NAME_CONFLICT');
    expect(error.status).toBe(409);
    // The conflict dialog needs this specific field, so it is surfaced rather
    // than left buried in an untyped bag.
    expect(error.suggestedName).toBe('Report (1).pdf');
  });

  it('WEB-SHARED-019 every ErrorCode maps to a message and a recovery action', () => {
    // Exhaustive by construction — the map is `Record<ErrorCode, Recovery>`, so
    // a new code fails the build until someone decides what a user is told.
    // Asserted anyway, because the type would be satisfied by an empty string.
    for (const code of ErrorCodeSchema.options) {
      const recovery = errorMessages[code];
      expect(recovery, code).toBeDefined();
      expect(recovery.message.length, code).toBeGreaterThan(10);
      expect(recovery.message, code).not.toContain(code);
    }
  });

  it('WEB-SHARED-020 an unrecognised code falls back to a generic message rather than rendering the code', () => {
    // A server one deploy ahead of this bundle. The user must not be shown
    // `SOMETHING_NEW_ENTIRELY`.
    const error = new AppError('api', 'SOMETHING_NEW_ENTIRELY' as never, 'raw', 500);
    const recovery = describeError(error);

    expect(recovery.message).toBe(errorMessages.INTERNAL.message);
    expect(recovery.message).not.toContain('SOMETHING_NEW_ENTIRELY');
  });

  it('WEB-SHARED-021 a network failure is distinguishable from a server error in the UI', () => {
    const offline = toAppError(new AxiosError('Network Error', 'ERR_NETWORK'));
    const serverError = toAppError(axiosErrorWith(500, { code: 'INTERNAL', message: 'boom' }));

    expect(offline.kind).toBe('network');
    expect(serverError.kind).toBe('api');
    // "Check your connection" and "it's not you" are different instructions,
    // and collapsing them into one leaves both unactionable.
    expect(describeError(offline).message).not.toBe(describeError(serverError).message);
  });

  it('WEB-SHARED-022 a timeout surfaces as retryable', () => {
    const timedOut = toAppError(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'));

    expect(timedOut.kind).toBe('timeout');
    expect(timedOut.retryable).toBe(true);
    expect(describeError(timedOut).action).toBe('retry');
  });

  it('WEB-SHARED-023 a 500 body that is not the error envelope still produces an AppError', () => {
    // A proxy timeout page, a CDN error, an empty body. None of them parse, and
    // all of them must still yield something a component can render instead of
    // a TypeError reading `.code` of undefined.
    for (const body of ['<html>502 Bad Gateway</html>', '', null, { unexpected: true }, 0]) {
      const error = toAppError(axiosErrorWith(500, body));
      expect(error, JSON.stringify(body)).toBeInstanceOf(AppError);
      expect(error.code).toBe('INTERNAL');
      expect(error.status).toBe(500);
    }
  });

  it('WEB-SHARED-024 no user-facing message contains a stack trace or a raw server string', () => {
    const leaky = axiosErrorWith(
      500,
      'PrismaClientKnownRequestError: Unique constraint failed on the fields: (`name`,`parent_id`)\n    at /app/dist/main.js:42:11',
    );
    const error = toAppError(leaky);
    const shown = describeError(error).message;

    for (const fragment of ['Prisma', 'parent_id', '/app/dist', ' at ', 'constraint']) {
      expect(shown, fragment).not.toContain(fragment);
    }
    expect(error.message).toBe('Something went wrong');
  });

  it('WEB-SHARED-027 a response failing schema validation is surfaced as an error, not rendered', async () => {
    const adapter: AxiosAdapter = (config) =>
      Promise.resolve({
        // A server one version ahead: `name` became `title`.
        data: { id: '11111111-1111-4111-8111-111111111111', title: 'Renamed field' },
        status: 200,
        statusText: '200',
        headers: new AxiosHeaders(),
        config: config as AxiosResponse['config'],
      });

    const client = createApiClient();
    client.defaults.adapter = adapter;

    // Half-valid data reaching a component produces a blank cell or a crash
    // three components away from the cause. Failing the request is louder and
    // much easier to trace.
    await expect(request(NodeSummarySchema, { url: '/nodes/x' }, client)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: 'The server sent an unexpected response',
    });
  });
});
