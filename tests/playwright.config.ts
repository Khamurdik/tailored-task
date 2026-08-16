import { defineConfig, devices } from '@playwright/test';

/**
 * User journeys only. Anything provable at a lower tier belongs at that tier —
 * an e2e suite that duplicates unit coverage is slow and flaky for no gain.
 *
 * Playwright writes its own JSON into the same runs/ directory as Vitest, so
 * one history CLI can read both. See TODO.md §5.
 */
export default defineConfig({
  testDir: './suites/journeys',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['list'],
    ['json', { outputFile: 'runs/latest-e2e.json' }],
    ['html', { outputFolder: 'runs/e2e-report', open: 'never' }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @dataroom/web dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
