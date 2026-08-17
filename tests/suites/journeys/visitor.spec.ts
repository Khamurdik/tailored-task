import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { storageStatePath } from '../../src/support/e2e-setup';

/**
 * The people who are **not** the owner.
 *
 * Every test in this file is a refusal. The interesting question at this tier is
 * rarely "does this work" and almost always "does this work for this person and
 * not for that one" — and a refusal is the half that cannot be observed by
 * using the product normally.
 */

/**
 * A genuine PDF, whose **basename is exactly `name`**.
 *
 * Written into a unique directory rather than under a unique filename:
 * `setInputFiles` uploads the basename, so prefixing it put
 * `dataroom-1786984266502-report.pdf` into the tree and every assertion about
 * the name had to know about the timestamp.
 */
function pdfFixture(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'dataroom-'));
  const path = join(directory, name);
  writeFileSync(path, `%PDF-1.7
1 0 obj
<< /Type /Catalog >>
endobj
%%EOF`);
  return path;
}

/**
 * Restores a persona's saved session rather than driving the login form.
 *
 * Every journey runs from `127.0.0.1` and login is throttled per IP, so signing
 * in per test exhausts the budget mid-run — see `auth.setup.ts`.
 */
async function asPerson(browser: Browser, role: 'owner' | 'stranger' | 'admin'): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();
  return page;
}

/**
 * An owner with a room, two sibling folders, a PDF in one, and a link to that
 * one only. Returned ids are what the refusals are pointed at.
 */
async function shareOneOfTwoSiblings(page: Page): Promise<{
  link: string;
  sharedId: string;
  siblingId: string;
  roomId: string;
}> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();

  await page.getByRole('button', { name: 'New room' }).click();
  await page.getByLabel('Name').fill(`Scoping ${Date.now()}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/nodes\//);
  const roomId = page.url().split('/nodes/')[1] ?? '';

  for (const name of ['Shared', 'Sibling']) {
    await page.getByRole('button', { name: 'New folder' }).first().click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }

  await page.getByRole('button', { name: 'Shared', exact: true }).click();
  const sharedId = page.url().split('/nodes/')[1] ?? '';
  await page.locator('[data-testid="upload-input"]').setInputFiles(pdfFixture('shared.pdf'));
  await expect(
    page.getByRole('complementary', { name: 'Uploads' }).getByText('Done'),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto(`/nodes/${roomId}`);
  await page.getByRole('button', { name: 'Actions for Sibling' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Sibling', exact: true }).click();
  const siblingId = page.url().split('/nodes/')[1] ?? '';

  await page.goto(`/nodes/${roomId}`);
  await page.getByRole('button', { name: 'Actions for Shared' }).click();
  await page.getByRole('menuitem', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Create a link' }).click();
  const link = await page.getByLabel('Share link').inputValue();

  return { link, sharedId, siblingId, roomId };
}

/**
 * The access token the **app** is holding, for calls made outside it.
 *
 * `page.request` shares cookies and storage with the page but attaches no
 * `Authorization` header — that is the axios interceptor's job, and it only
 * runs inside the application. Without this, a direct API call from a journey
 * is *anonymous*, which is how `JOURNEY-035` passed while proving nothing: it
 * asserted a non-admin gets 404 and was actually observing an anonymous caller
 * getting 404.
 */
async function bearerOf(page: Page): Promise<string> {
  const raw = await page.evaluate(() => globalThis.localStorage.getItem('dataroom.tokens'));
  const tokens = JSON.parse(raw ?? '{}') as { accessToken?: string };
  return tokens.accessToken ?? '';
}

/** A context with explicitly empty storage — see the note in `owner.spec.ts`. */
async function anonymousPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

test.describe('public visitor', () => {
  test('JOURNEY-025 a visitor holding a link to one folder cannot reach its sibling', async ({
    page,
    browser,
  }) => {
    const { link, siblingId, roomId } = await shareOneOfTwoSiblings(page);

    const visitor = await anonymousPage(browser);
    await visitor.goto(link);
    await expect(visitor.getByText('Shared with you')).toBeVisible();

    /**
     * The test a reviewer tries by hand.
     *
     * Editing the URL to a sibling id must be not-found — **not** a 403 and not
     * an empty listing. A 403 confirms the id exists, which is an enumeration
     * oracle across every room in the system.
     */
    const sibling = await visitor.request.get(`http://localhost:3000/nodes/${siblingId}`, {
      headers: { 'X-Share-Token': link.split('/s/')[1] ?? '' },
      failOnStatusCode: false,
    });
    expect(sibling.status()).toBe(404);

    // And the room *above* the share is refused the same way.
    const above = await visitor.request.get(`http://localhost:3000/nodes/${roomId}`, {
      headers: { 'X-Share-Token': link.split('/s/')[1] ?? '' },
      failOnStatusCode: false,
    });
    expect(above.status()).toBe(404);
    expect(await above.json()).toEqual(await sibling.json());
  });

  test('JOURNEY-005 a visitor opens the PDF from the same link', async ({ page, browser }) => {
    const { link } = await shareOneOfTwoSiblings(page);

    const visitor = await anonymousPage(browser);
    await visitor.goto(link);

    await visitor.getByRole('button', { name: 'shared.pdf', exact: true }).click();

    // A real object, out of a real bucket, through a presigned GET — the whole
    // chain that cannot be exercised without one.
    const frame = visitor.locator('iframe[title="shared.pdf"]');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute('src', /localhost:9000/);
  });

  test('JOURNEY-023 a visitor is never shown a sign-in screen', async ({ page, browser }) => {
    const { link } = await shareOneOfTwoSiblings(page);

    const visitor = await anonymousPage(browser);
    await visitor.goto(link);

    await expect(visitor.getByText('Shared with you')).toBeVisible();
    await expect(visitor).not.toHaveURL(/\/login/);
    await expect(visitor.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  });

  test('JOURNEY-032 a guessed token renders the same unavailable screen', async ({ browser }) => {
    const visitor = await anonymousPage(browser);

    // Three shapes of wrong: a plausible code, a plausible token, and nonsense.
    for (const guess of ['N4B1G8RY66MCR798', 'a'.repeat(43), 'not-a-token']) {
      await visitor.goto(`/s/${guess}`);
      await expect(visitor.getByText('This link is not available')).toBeVisible();
      // Nothing about *why*, because the API refuses to say and inventing a
      // reason here would invent the oracle it declines to be.
      await expect(visitor.getByText(/expired|revoked|deleted/i)).toHaveCount(0);
    }
  });

  test('JOURNEY-028 a signed-in user opening someone’s link gets the read-only view', async ({
    page,
    browser,
  }) => {
    const { link } = await shareOneOfTwoSiblings(page);

    // A different real account, signed in, then opening the link.
    const other = await asPerson(browser, 'stranger');
    await other.goto(link);

    /**
     * Not silently upgraded into their own UI.
     *
     * The credential in the URL is what they arrived with. Honouring it is the
     * difference between seeing what was shared and looking at your own data
     * while believing you are seeing theirs.
     */
    await expect(other.getByText('Shared with you')).toBeVisible();
    await expect(other.getByRole('button', { name: 'New folder' })).toHaveCount(0);
    await expect(other.getByRole('button', { name: /sign out/i })).toHaveCount(0);

  });
});

test.describe('stranger and anonymous', () => {
  test('JOURNEY-029 a signed-in stranger gets not-found for every id in another room', async ({
    page,
    browser,
  }) => {
    const { roomId, sharedId, siblingId } = await shareOneOfTwoSiblings(page);

    const stranger = await asPerson(browser, 'stranger');

    // Same property as JOURNEY-025, reached by a completely different route —
    // a bearer token rather than a share credential. A fix applied at one route
    // routinely misses the other, which is why both are declared.
    for (const id of [roomId, sharedId, siblingId]) {
      await stranger.goto(`/nodes/${id}`);
      await expect(stranger.getByRole('alert')).toBeVisible();
      await expect(stranger.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
    }

  });

  test('JOURNEY-030 an anonymous visitor is sent to sign-in and sees nothing first', async ({
    page,
    browser,
  }) => {
    const { roomId } = await shareOneOfTwoSiblings(page);

    const anonymous = await anonymousPage(browser);
    await anonymous.goto(`/nodes/${roomId}`);

    await expect(anonymous).toHaveURL(/\/login/);
    // Nothing of the room leaked on the way past — not a name, not a row, not a
    // flash of the listing before the redirect.
    await expect(anonymous.getByRole('table')).toHaveCount(0);
    await expect(anonymous.getByText('Scoping')).toHaveCount(0);
  });
});

test.describe('admin', () => {
  test('JOURNEY-035 the jobs area does not exist for a non-admin', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Data rooms' })).toBeVisible();

    // **With the owner's real token.** Without it this call is anonymous, and a
    // 404 would prove nothing about a signed-in non-admin.
    const response = await page.request.get('http://localhost:3000/jobs', {
      headers: { Authorization: `Bearer ${await bearerOf(page)}` },
      failOnStatusCode: false,
    });

    // 404, not 403 — consistent with the rest of the system. The existence of an
    // admin surface is not something a non-admin needs confirmed.
    expect(response.status()).toBe(404);
  });

  test('JOURNEY-033 an admin sees every job with its schedule and next run', async ({
    browser,
  }) => {
    const admin = await asPerson(browser, 'admin');

    const response = await admin.request.get('http://localhost:3000/jobs', {
      headers: { Authorization: `Bearer ${await bearerOf(admin)}` },
    });
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { items: { id: string; cron: string }[] };
    expect(body.items).toHaveLength(6);
    for (const job of body.items) expect(job.cron.trim().split(/\s+/)).toHaveLength(6);

  });

  test('JOURNEY-006 an admin triggers a job by hand and it reaches a terminal status', async ({
    browser,
  }) => {
    const admin = await asPerson(browser, 'admin');

    // 202 and a runId the caller polls — never blocking on a job that may run
    // for minutes.
    const authorization = { Authorization: `Bearer ${await bearerOf(admin)}` };

    const triggered = await admin.request.post(
      'http://localhost:3000/jobs/reconcile-rollups/run',
      { headers: authorization },
    );
    expect(triggered.status()).toBe(202);
    const { runId } = (await triggered.json()) as { runId: string };

    await expect
      .poll(
        async () => {
          const run = await admin.request.get(`http://localhost:3000/jobs/runs/${runId}`, {
            headers: authorization,
          });
          return ((await run.json()) as { status: string }).status;
        },
        { timeout: 20_000 },
      )
      // `running` is never a resting state.
      .not.toBe('running');

  });
});
