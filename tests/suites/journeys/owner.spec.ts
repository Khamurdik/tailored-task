import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { PEOPLE } from '../../src/support/e2e-setup';

/**
 * The owner's journeys.
 *
 * Everything here goes through the real browser, the real API, a real Postgres
 * and a real bucket. A behaviour provable in `web/*` or `api/*` belongs there —
 * what is left is what only exists when all four are in play.
 */

/**
 * A genuine PDF, whose **basename is exactly `name`**.
 *
 * Written into a unique directory rather than under a unique filename:
 * `setInputFiles` uploads the basename, so prefixing it put
 * `dataroom-1786984266502-report.pdf` into the tree and every assertion about
 * the name had to know about the timestamp.
 */
function pdfFixture(name: string, text = 'journey'): string {
  const directory = mkdtempSync(join(tmpdir(), 'dataroom-'));
  const path = join(directory, name);
  writeFileSync(path, `%PDF-1.7
1 0 obj
<< /Type /Catalog >>
endobj
% ${text}
%%EOF`);
  return path;
}

/**
 * Already signed in as the owner — `auth.setup.ts` saved the session and the
 * project's `storageState` restores it. This only has to land on the app.
 *
 * Signing in through the form in every test exceeded the login throttle
 * part-way through the run; see the setup project's comment.
 */
async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();
}

/** The one journey that genuinely needs the form is JOURNEY-013. */
async function signInThroughForm(page: Page, who: { email: string; password: string }): Promise<void> {
  await page.getByLabel(/email/i).fill(who.email);
  await page.getByLabel(/password/i).fill(who.password);
  await page.getByRole('button', { name: /sign in/i }).click();
}

/** A room with a unique name, so journeys cannot collide in a shared database. */
async function createRoom(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'New room' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/nodes\//);
  return page.url().split('/nodes/')[1] ?? '';
}

async function createFolder(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New folder' }).first().click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function uploadPdf(page: Page, path: string): Promise<void> {
  await page.locator('[data-testid="upload-input"]').setInputFiles(path);
  // The panel reports the terminal state. Waiting on the listing instead would
  // pass the moment the row appeared, before `/complete` had verified anything.
  await expect(page.getByRole('complementary', { name: 'Uploads' }).getByText('Done')).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('owner — the core loop', () => {
  /**
   * **The one test to keep working if everything else is cut.**
   *
   * It is the product in one pass: upload real bytes to a real bucket, share the
   * folder, open the link in a context with **no storage at all**, confirm the
   * visitor can read and cannot mutate, then revoke and watch it die.
   */
  test('JOURNEY-001 an owner uploads, shares, and a visitor sees read-only content until it is revoked', async ({
    page,
    browser,
  }) => {
    await openApp(page);

    const room = `Meridian ${Date.now()}`;
    await createRoom(page, room);
    await createFolder(page, 'Diligence');
    await page.getByRole('button', { name: 'Diligence', exact: true }).click();

    await uploadPdf(page, pdfFixture('report.pdf'));
    await expect(page.getByRole('button', { name: 'report.pdf', exact: true })).toBeVisible();

    // Share the folder the visitor should see — not the room above it.
    await page.goBack();
    await page.getByRole('button', { name: 'Actions for Diligence' }).click();
    await page.getByRole('menuitem', { name: 'Share' }).click();
    await page.getByRole('button', { name: 'Create a link' }).click();

    const link = await page.getByLabel('Share link').inputValue();
    expect(link).toContain('/s/');

    /**
     * A context with **explicitly empty storage**.
     *
     * This project keeps bearer tokens in `localStorage`, so a leaked storage
     * state would silently authenticate the "anonymous" visitor — and the test
     * would pass while proving nothing at all. That is the note in
     * `journeys/TODO.md`, and it is the single most important line in this file.
     */
    const visitorContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const visitor = await visitorContext.newPage();

    await visitor.goto(link);
    await expect(visitor.getByText('Shared with you')).toBeVisible();
    await expect(visitor.getByRole('button', { name: 'report.pdf', exact: true })).toBeVisible();

    // Read-only: every mutating affordance is **absent**, not disabled.
    await expect(visitor.getByRole('button', { name: 'New folder' })).toHaveCount(0);
    await expect(visitor.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
    await expect(visitor.locator('[data-testid="upload-input"]')).toHaveCount(0);

    // Revoke, from the owner's tab.
    await page.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog', { name: /Revoke access/ }).getByRole('button', { name: 'Revoke' }).click();

    // The very next load is dead. No cache, no grace period — the credential is
    // presented on every request and the resolver excludes revoked grants.
    await visitor.reload();
    await expect(visitor.getByText('This link is not available')).toBeVisible();

    await visitorContext.close();
  });

  test('JOURNEY-009 two uploads of one name both land under distinct names', async ({ page }) => {
    await openApp(page);
    await createRoom(page, `Collisions ${Date.now()}`);

    await uploadPdf(page, pdfFixture('same.pdf', 'first'));
    await uploadPdf(page, pdfFixture('same.pdf', 'second'));

    /**
     * Both land, and neither overwrites the other.
     *
     * The name is reserved by a `pending` row at `/uploads/init`, so the unique
     * index arbitrates while nothing has been transferred rather than at the end
     * when the bytes are already spent.
     */
    await expect(page.getByRole('button', { name: 'same.pdf', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'same (1).pdf', exact: true })).toBeVisible();
  });

  test('JOURNEY-010 reloading mid-session lands back in the same folder, still signed in', async ({
    page,
  }) => {
    await openApp(page);
    await createRoom(page, `Reload ${Date.now()}`);
    await createFolder(page, 'Deep');
    await page.getByRole('button', { name: 'Deep', exact: true }).click();

    const url = page.url();
    await page.reload();

    // The folder id is in the URL rather than in component state, which is what
    // makes this work — and the session survives because the tokens are in
    // `localStorage` and the bootstrap re-reads them.
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Deep');
  });

  test('JOURNEY-007 the delete confirmation shows true subtree counts before confirming', async ({
    page,
  }) => {
    await openApp(page);
    await createRoom(page, `Counted ${Date.now()}`);
    await createFolder(page, 'Branch');
    await page.getByRole('button', { name: 'Branch', exact: true }).click();
    await uploadPdf(page, pdfFixture('inside.pdf'));

    await page.goBack();
    await page.getByRole('button', { name: 'Actions for Branch' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    // From `/stats`, computed live — not from the denormalized rollups, which
    // are reconciled daily and would make this number a guess.
    await expect(page.getByRole('dialog')).toContainText('0 folders and 1 file');
  });
});

test.describe('owner — identity', () => {
  test('JOURNEY-016 no account can be created from anywhere in the UI', async ({ page }) => {
    await page.goto('/login');

    /**
     * There is no registration, and this asserts the absence rather than the
     * behaviour: no link, no route, and `POST /auth/register` is a 404 from the
     * router because the handler does not exist.
     */
    for (const invitation of [/sign up/i, /create an account/i, /register/i]) {
      await expect(page.getByText(invitation)).toHaveCount(0);
    }

    const response = await page.request.post('/api/auth/register', {
      data: { email: 'nobody@example.com', password: 'whatever-it-is' },
      failOnStatusCode: false,
    });
    expect(response.status()).toBe(404);
  });

  test('JOURNEY-013 a deep link opened while signed out returns to that exact link after signing in', async ({
    page,
  }) => {
    await openApp(page);
    const roomId = await createRoom(page, `DeepLink ${Date.now()}`);

    // Sign out, then ask for the folder directly.
    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto(`/nodes/${roomId}`);
    await expect(page).toHaveURL(/\/login/);

    await signInThroughForm(page, PEOPLE.owner);

    // Back to what was asked for, not to the root. `safeReturnPath` validates
    // the destination rather than sanitising it, so this cannot be turned into
    // an open redirect.
    await expect(page).toHaveURL(new RegExp(`/nodes/${roomId}`));
  });
});
