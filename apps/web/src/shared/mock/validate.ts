import type { z } from 'zod';

/**
 * Parses a response the mock is about to send through its contract schema.
 *
 * A fixture that drifts from the contract is caught at load; a *handler* that
 * builds a malformed page is the same bug arriving later, and this is what
 * catches it. Without both checks, "the mock validates its fixtures" is only
 * half true — the interesting responses are assembled, not read from a file.
 *
 * Dev-only. In a production build the mock is off entirely, so this never runs
 * there; the guard is belt and braces for the case where someone imports this
 * module directly.
 */
export function validateResponse<T extends z.ZodType>(
  schema: T,
  body: unknown,
  where: string,
): unknown {
  if (import.meta.env.PROD) return body;

  const result = schema.safeParse(body);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Thrown, not logged. A response that does not match the contract is a bug
    // in the mock, and a mock that quietly serves the wrong shape is worse than
    // no mock at all — the UI gets built against it.
    throw new Error(`Mock response for ${where} does not match the contract:\n${problems}`);
  }
  return body;
}
