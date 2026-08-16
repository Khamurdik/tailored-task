import tseslint from 'typescript-eslint';

import base from '../eslint.config.base.mjs';

export default tseslint.config(...base, {
  files: ['**/*.{ts,tsx}'],
  rules: {
    // Fixtures and arrange blocks legitimately use loose shapes.
    '@typescript-eslint/no-explicit-any': 'off',
    // Vitest's expect chains are expressions.
    '@typescript-eslint/no-unused-expressions': 'off',
  },
});
