import tseslint from 'typescript-eslint';

import base from '../../eslint.config.base.mjs';

export default tseslint.config(...base, {
  files: ['**/*.ts'],
  rules: {
    // Nest modules are classes with no members by design.
    '@typescript-eslint/no-extraneous-class': 'off',
    // Decorator metadata makes empty constructors meaningful.
    '@typescript-eslint/no-useless-constructor': 'off',
  },
});
