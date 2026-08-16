import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared flat config. Each package extends this and adds its own environment.
 *
 * Deliberately NOT using the type-aware presets (`recommendedTypeChecked`):
 * they require a TypeScript Program, which is the same compiler API that
 * TypeScript 7 removed. Staying on the syntactic rules keeps lint working if
 * the workspace later moves to TS 7 before typescript-eslint supports it.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    rules: {
      // TypeScript already reports undefined identifiers, and ESLint's version
      // has no view of ambient/DOM types, so it only produces false positives.
      'no-undef': 'off',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
