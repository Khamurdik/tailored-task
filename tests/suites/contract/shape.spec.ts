import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as contract from '@dataroom/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

const REPO_ROOT = new URL('../../../', import.meta.url);

const schemaExports = (Object.entries(contract) as [string, unknown][]).filter(
  (entry): entry is [string, z.ZodType] =>
    entry[0].endsWith('Schema') && entry[1] instanceof z.ZodType,
);

// Kept as `ZodType` rather than narrowed to `ZodObject`: everything below only
// calls `safeParse`, and naming the object type drags zod's shape generics
// into a test that has no opinion about them.
const objectSchemas = schemaExports.filter(([, schema]) => schema instanceof z.ZodObject);

describe('shape and inference', () => {
  it('CONTRACT-001 every exported DTO type is inferred from a schema, never hand-written', () => {
    // The type half is static — these fail at compile time, not at run time.
    expectTypeOf<contract.NodeSummary>().toEqualTypeOf<
      z.infer<typeof contract.NodeSummarySchema>
    >();
    expectTypeOf<contract.NodeDetail>().toEqualTypeOf<z.infer<typeof contract.NodeDetailSchema>>();
    expectTypeOf<contract.ChildrenPage>().toEqualTypeOf<
      z.infer<typeof contract.ChildrenPageSchema>
    >();
    expectTypeOf<contract.LoginResponse>().toEqualTypeOf<
      z.infer<typeof contract.LoginResponseSchema>
    >();
    expectTypeOf<contract.CreatedShare>().toEqualTypeOf<
      z.infer<typeof contract.CreatedShareSchema>
    >();
    expectTypeOf<contract.ResolveShareResponse>().toEqualTypeOf<
      z.infer<typeof contract.ResolveShareResponseSchema>
    >();
    expectTypeOf<contract.JobSummary>().toEqualTypeOf<z.infer<typeof contract.JobSummarySchema>>();
    expectTypeOf<contract.ApiError>().toEqualTypeOf<z.infer<typeof contract.ApiErrorSchema>>();

    // The runtime half: a type can only be inferred from a schema if the
    // schema is exported, so every `*Schema` export must actually be one.
    expect(schemaExports.length).toBeGreaterThan(0);
    for (const [name, schema] of schemaExports) {
      expect(schema, `${name} is exported as a schema but is not a zod type`).toBeInstanceOf(
        z.ZodType,
      );
    }
  });

  it('CONTRACT-002 a response missing a required field fails to parse', () => {
    const complete: contract.ResolveShareResponse = {
      rootNodeId: '11111111-1111-4111-8111-111111111111',
      role: 'viewer',
      expiresAt: null,
    };
    expect(contract.ResolveShareResponseSchema.safeParse(complete).success).toBe(true);

    const { role: _role, ...missingRole } = complete;
    const result = contract.ResolveShareResponseSchema.safeParse(missingRole);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('role');
  });

  it('CONTRACT-003 a response with an unknown extra field is rejected, not silently passed through', () => {
    // Asserted across every object schema rather than one sample. An API that
    // silently accepts extra fields cannot detect a client on an old contract,
    // and it only takes one non-strict schema to lose that.
    const notStrict: string[] = [];

    for (const [name, schema] of objectSchemas) {
      const result = schema.safeParse({ __unexpected__: true });
      const rejectsUnknown =
        !result.success &&
        result.error.issues.some((issue) => issue.code === 'unrecognized_keys');
      if (!rejectsUnknown) notStrict.push(name);
    }

    expect(notStrict, 'these schemas accept unknown keys — use z.strictObject').toEqual([]);
  });

  it('CONTRACT-004 ErrorCode union covers every code the API is specified to emit', () => {
    // The spec is the source. Reading the codes back out of it means this test
    // fails when the two disagree, rather than restating the implementation.
    const spec = readFileSync(fileURLToPath(new URL('packages/shared/TODO.md', REPO_ROOT)), 'utf8');

    // Anchored on the block's contents, not on the checklist line above it.
    // An earlier version keyed off `- [ ] Error codes:` and went red the first
    // time someone ticked the box — which is a fair warning about reading a
    // spec as data, and an argument for matching the part that carries meaning.
    const block = [...spec.matchAll(/```ts\n([\s\S]*?)```/g)]
      .map((match) => match[1] ?? '')
      .find((body) => body.includes("'NAME_CONFLICT'"));

    expect(block, 'could not find the error-code block in packages/shared/TODO.md').toBeTruthy();

    const specified = new Set((block ?? '').match(/'[A-Z][A-Z_]*'/g)?.map((s) => s.slice(1, -1)));
    const exported = new Set<string>(contract.ErrorCodeSchema.options);

    expect([...specified].sort()).toEqual([...exported].sort());
  });
});
