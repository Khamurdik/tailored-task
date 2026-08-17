import type { AxiosInstance, AxiosRequestConfig } from 'axios';
import type { z } from 'zod';

import { AppError, toAppError } from '../errors/app-error';
import { api } from './client';

/**
 * A request whose response is **parsed against the shared schema**.
 *
 * The contract package exists so a renamed field is a compile error on both
 * sides. That only holds at compile time; at run time a server one deploy
 * ahead can still send a shape this bundle does not expect, and the cast that
 * `response.data as T` performs would hand it straight to a component.
 *
 * So the shape is checked, and a mismatch is **surfaced as an error rather
 * than rendered**. A half-valid object reaching the UI produces a blank cell,
 * an `undefined` in a template, or a crash three components away from the
 * cause — all of which are harder to diagnose than a failed request.
 */
export async function request<T extends z.ZodType>(
  schema: T,
  config: AxiosRequestConfig,
  client: AxiosInstance = api,
): Promise<z.infer<T>> {
  let data: unknown;

  try {
    ({ data } = await client.request(config));
  } catch (cause) {
    throw toAppError(cause);
  }

  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;

  // The issue list is deliberately kept in `details` rather than in the
  // message: it names field paths from the wire format, which is useful in a
  // console and is not something to show a person.
  throw new AppError(
    'api',
    'INTERNAL',
    'The server sent an unexpected response',
    null,
    { issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
  );
}
