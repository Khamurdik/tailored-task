import { fileURLToPath, URL } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * One runner for the whole system. Four projects, because they need different
 * environments and have very different costs — `--project` lets the fast ones
 * run on every save and the slow ones run on demand.
 *
 * The api projects go through unplugin-swc rather than esbuild: esbuild does
 * not implement `emitDecoratorMetadata`, so any suite that boots a Nest module
 * would lose `design:paramtypes` and fail at injector time. See
 * docs/TOOLCHAIN.md.
 */
export default defineConfig({
  test: {
    projects: [
      {
        // The wire contract. Pure zod, no app, no database. Milliseconds.
        test: {
          name: 'contract',
          root: r('.'),
          include: ['suites/contract/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        // Pure functions and services with fakes. No I/O.
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'api-unit',
          root: r('.'),
          include: ['suites/api/**/*.unit.spec.ts'],
          environment: 'node',
        },
      },
      {
        // Boots the app against a real Postgres and a fake bucket.
        plugins: [swc.vite({ module: { type: 'es6' } })],
        test: {
          name: 'api-integration',
          root: r('.'),
          include: ['suites/api/**/*.int.spec.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          globalSetup: ['src/support/global-setup.ts'],
        },
      },
      {
        test: {
          name: 'web-unit',
          root: r('.'),
          include: ['suites/web/**/*.spec.tsx', 'suites/web/**/*.spec.ts'],
          environment: 'jsdom',
          setupFiles: ['src/support/web-setup.ts'],
        },
      },
    ],

    // File-based run log. The built-in json reporter is the interim mechanism;
    // it always overwrites runs/latest.json. Rotating it into a timestamped,
    // indexed history is src/reporters/run-log.reporter.ts — see TODO.md §5.
    reporters: [
      'default',
      ['json', { outputFile: 'runs/latest.json' }],
    ],

    coverage: {
      provider: 'v8',
      reportsDirectory: 'runs/coverage',
      reporter: ['text', 'json-summary', 'html'],
    },
  },
});
