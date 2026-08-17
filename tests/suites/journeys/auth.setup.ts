import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { expect, test as setup } from '@playwright/test';

import { PEOPLE, storageStatePath } from '../../src/support/e2e-setup';

/**
 * Signs each persona in **once**, and saves the result for every test to reuse.
 *
 * ## Why this exists rather than a `signIn()` helper per test
 *
 * Login is throttled to ten attempts a minute per IP, and every journey runs
 * from `127.0.0.1`. Fourteen tests each signing in through the form exceeded it
 * part-way through the run, and the failures landed on whichever tests happened
 * to be later — which reads as "the admin journeys are flaky" rather than as
 * "the suite is being rate limited".
 *
 * Turning the throttle off for tests was the other option and is the wrong one:
 * it is a real protection on the most attacked route in the system, and a suite
 * that only passes with it disabled is not testing what ships.
 *
 * The tokens are obtained from the API directly and written straight into
 * `localStorage`, because that is where this application keeps them — no
 * cookies anywhere, which is what removes CSRF as a category.
 */
/**
 * The origin the saved `localStorage` is attached to.
 *
 * It has to match the origin the tests actually browse, and it was hardcoded to
 * `http://localhost:5173` — which is right for the default run and silently
 * wrong for any other. Playwright restores storage state **per origin**, so
 * against an `E2E_BASE_URL` on a different port every persona loads with an
 * empty store, lands on the sign-in screen, and every authenticated journey
 * fails on a missing heading. Nothing says "you are signed out"; the failure
 * reads as the app being broken.
 *
 * Found by running the suite against a static build on another port. `baseURL`
 * in the config already derives from this variable — this is the one place that
 * did not.
 */
const APP_ORIGIN = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:5173').origin;

for (const [role, who] of Object.entries(PEOPLE)) {
  setup(`authenticate as ${role}`, async ({ request }) => {
    const response = await request.post('http://localhost:3000/auth/login', {
      data: { email: who.email, password: who.password },
    });
    expect(response.status(), `${role} could not sign in`).toBe(200);

    const session = (await response.json()) as { accessToken: string; refreshToken: string };

    const path = storageStatePath(role);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: APP_ORIGIN,
            localStorage: [
              {
                // The key `token-store` reads. Written directly rather than by
                // driving the form, so this costs one login per persona for the
                // whole run instead of one per test.
                name: 'dataroom.tokens',
                value: JSON.stringify({
                  accessToken: session.accessToken,
                  refreshToken: session.refreshToken,
                }),
              },
            ],
          },
        ],
      }),
      'utf8',
    );
  });
}

export { resolve };
