/**
 * The API contract. Both apps import this package, so renaming a response
 * field is a compile error on both sides rather than a runtime surprise.
 *
 * Every exported type is inferred with `z.infer`. None is hand-written — that
 * is asserted by `CONTRACT-001`, because a hand-written type that drifts from
 * its schema is worse than no type at all.
 */
export * from './constants.js';
export * from './errors.js';
export * from './pagination.js';
export * from './nodes.js';
export * from './uploads.js';
export * from './shares.js';
export * from './auth.js';
export * from './jobs.js';
export * from './events.js';
