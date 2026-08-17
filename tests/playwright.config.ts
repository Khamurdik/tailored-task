import { defineConfig, devices } from '@playwright/test';

/**
 * The database and seed are prepared by `src/support/e2e-prepare.ts`, which
 * `test:e2e` runs **before** this config is used. Playwright starts `webServer`
 * before `globalSetup`, so preparing there would be too late for the API's very
 * first connection.
 */
import { E2E_DATABASE_URL, SEED_USERS, storageStatePath } from './src/support/e2e-setup';

/**
 * User journeys only. Anything provable at a lower tier belongs at that tier —
 * an e2e suite that duplicates unit coverage is slow and flaky for no gain.
 *
 * What survives here is what only exists when the browser, the API **and the
 * bucket** are all real. That last one is why `docker-compose.test.yml` grew a
 * MinIO service: without a bucket the presigned PUT, the `HeadObject`, the
 * magic-byte range read and `Content-Disposition` are all unprovable, and three
 * of those four are security-relevant.
 *
 * Playwright writes its JSON into the same runs/ directory as Vitest, so one
 * history CLI can read both. See TODO.md §5.
 */
export default defineConfig({
  testDir: './suites/journeys',
  // Sequential. These share one database and one bucket, and a journey that
  // revokes a link while another is reading it is a flake with no cause.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,

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

  projects: [
    /**
     * Signs every persona in once and saves their storage.
     *
     * Login is throttled per IP and every journey runs from `127.0.0.1`, so a
     * suite that signs in through the form in each test exceeds the limit
     * part-way through and fails whichever tests happen to be later. Disabling
     * the throttle for tests was the alternative and is worse: it is a real
     * protection on the most attacked route in the system.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        // The owner is the default persona. Tests acting as someone else say so
        // with `test.use({ storageState })`, and the ones about **anonymous**
        // visitors build a context with explicitly empty storage instead.
        storageState: storageStatePath('owner'),
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          /**
           * The real API, on its own database and pointed at the local bucket.
           *
           * `JOBS_SCHEDULER_ENABLED=false`: the reaper would otherwise fire
           * mid-run and collect a pending upload a journey is halfway through.
           */
          command: 'pnpm --filter @dataroom/api start:prod',
          url: 'http://localhost:3000/health',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            NODE_ENV: 'test',
            PORT: '3000',
            DATABASE_URL: E2E_DATABASE_URL,
            JWT_ACCESS_SECRET: 'journeys-access-secret-not-real',
            JWT_REFRESH_SECRET: 'journeys-refresh-secret-not-real',
            SEED_USERS,
            AWS_REGION: 'us-east-1',
            S3_BUCKET: 'dataroom',
            S3_ENDPOINT: 'http://localhost:9000',
            AWS_ACCESS_KEY_ID: 'dataroom',
            AWS_SECRET_ACCESS_KEY: 'dataroom-secret',
            CORS_ORIGINS: 'http://localhost:5173',
            JOBS_SCHEDULER_ENABLED: 'false',
          },
        },
        {
          // `--mode e2e` loads `apps/web/.env.e2e`, which beats any
          // `.env.local` a developer has. Passing `VITE_API_MODE` through `env`
          // below is **not** enough: Vite's env files take precedence, so a
          // local `mock` would silently win and the journeys would run against
          // the placeholder data layer.
          command: 'pnpm --filter @dataroom/web dev --mode e2e',
          url: 'http://localhost:5173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: { VITE_API_MODE: 'live' },
        },
      ],
});
