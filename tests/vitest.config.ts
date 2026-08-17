import { fileURLToPath, URL } from 'node:url';

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The same aliases `tsconfig.json` declares under `compilerOptions.paths`.
 *
 * They have to be repeated because Vite does not read tsconfig paths — the
 * editor resolves `@api/...` from the tsconfig and the runner resolves it from
 * here, so the two must be kept in step. The symptom when they drift is a
 * "Cannot find package" at run time on an import the editor is perfectly happy
 * with.
 */
const alias = {
  '@api': r('../apps/api/src'),
  '@web': r('../apps/web/src'),
  '@support': r('./src/support'),
  // The web app's own internal alias. Needed because these suites import web
  // source, and that source imports itself through `@/`. Written with the
  // trailing slash so it cannot shadow `@web/` — a bare `@` key would match
  // that prefix too, and the failure reads as a missing file.
  '@/': `${r('../apps/web/src')}/`,
};

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
        // The coverage gate. Parses every `## Declared tests` table and emits
        // one failing test per declared ID with no implementation, which is
        // what makes run #1 red — see TODO.md §4.
        //
        // It lives in src/, not suites/, so it needs its own project: the
        // other four only include `suites/**` and would never collect it.
        //
        // It discovers implementations by scanning test titles across BOTH
        // runners' spec files (suites/**, including the Playwright journeys)
        // rather than by reading run output, so a JOURNEY-* declaration counts
        // as implemented without Playwright having run.
        test: {
          name: 'gate',
          root: r('.'),
          include: ['src/registry/**/*.spec.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        // The wire contract. Pure zod, no app, no database. Milliseconds.
        test: {
          name: 'contract',
          root: r('.'),
          include: ['suites/contract/**/*.spec.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        // Pure functions and services with fakes. No I/O.
        plugins: [swc.vite({ module: { type: 'es6' } })],
        resolve: { alias },
        test: {
          name: 'api-unit',
          root: r('.'),
          include: ['suites/api/**/*.unit.spec.ts'],
          environment: 'node',
          globals: true,
        },
      },
      {
        // Boots the app against a real Postgres and a fake bucket.
        plugins: [swc.vite({ module: { type: 'es6' } })],
        resolve: { alias },
        test: {
          name: 'api-integration',
          root: r('.'),
          include: ['suites/api/**/*.int.spec.ts'],
          environment: 'node',
          globals: true,
          fileParallelism: false,
          testTimeout: 30_000,
          globalSetup: ['src/support/global-setup.ts'],
          // `reflect-metadata` before any decorated class is evaluated.
          setupFiles: ['src/support/api-setup.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'web-unit',
          root: r('.'),
          include: ['suites/web/**/*.spec.tsx', 'suites/web/**/*.spec.ts'],
          environment: 'jsdom',
          globals: true,
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
