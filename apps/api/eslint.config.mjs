import tseslint from 'typescript-eslint';

import base from '../../eslint.config.base.mjs';

export default tseslint.config(...base, {
  files: ['**/*.ts'],
  rules: {
    // Nest modules are classes with no members by design.
    '@typescript-eslint/no-extraneous-class': 'off',
    // Decorator metadata makes empty constructors meaningful.
    '@typescript-eslint/no-useless-constructor': 'off',

    /**
     * Off in this package, and this is the important one.
     *
     * The rule is right in general and wrong here in a way that fails at
     * runtime rather than at compile time. Nest resolves constructor
     * dependencies from `design:paramtypes`, which `emitDecoratorMetadata`
     * writes from the constructor's parameter types. An `import type` is erased
     * before that metadata is emitted, so the recorded type becomes `Object`
     * and the injector fails with "Nest can't resolve dependencies of X" —
     * pointing at the class, not at the import that broke it.
     *
     * `--fix` applies it automatically, which turns a lint tidy-up into a
     * boot failure. Off is safer than a per-file exception nobody remembers to
     * add. It stays on everywhere else in the workspace.
     */
    '@typescript-eslint/consistent-type-imports': 'off',
  },
});
