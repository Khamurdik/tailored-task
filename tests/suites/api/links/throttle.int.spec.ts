import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '@support/app';

/**
 * The throttle, in a file of its own.
 *
 * It needs an app instance nobody else has spent the budget of: the limit is
 * per-IP over a rolling minute, every suite's requests come from `127.0.0.1`,
 * and the storage lives for as long as the module does. Sharing an app with the
 * resolution suite would mean either that suite failing with 429s or this one
 * starting from an unknown offset.
 *
 * `api-integration` runs with `fileParallelism: false`, so one file is one app
 * and the budget here is untouched.
 */
let app: TestApp;
let server: Parameters<typeof request>[0];

beforeAll(async () => {
  app = await createTestApp();
  server = app.http.getHttpServer();
});

afterAll(async () => {
  await app.close();
});

describe('rate limiting the guessing surface', () => {
  it('API-LINKS-022 repeated resolution attempts from one IP are throttled', async () => {
    // Every request here is an unknown credential — the shape a guessing run
    // takes. This endpoint is the guessing surface for every share in the
    // system, and no legitimate visitor resolves more than a handful of links a
    // minute: they open one and read it.
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await request(server)
        .get('/shares/resolve')
        .set('X-Share-Token', `guess-number-${attempt}`);
      statuses.push(response.status);
    }

    const throttled = statuses.filter((status) => status === 429);
    const refused = statuses.filter((status) => status === 404);

    // The first requests are answered normally and the rest are cut off. Both
    // halves matter: a limit that never triggers is decoration, and one that
    // triggers immediately would break the legitimate visitor it exists to
    // protect.
    expect(refused.length, 'some attempts answered before the limit').toBeGreaterThan(0);
    expect(throttled.length, 'the limit is actually enforced').toBeGreaterThan(0);

    // And it is tighter than the global 120/minute — this route sets its own.
    expect(refused.length).toBeLessThan(30);
  }, 30_000);
});
