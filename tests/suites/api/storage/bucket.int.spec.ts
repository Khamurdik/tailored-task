import { randomUUID } from 'node:crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadConfig, type AppConfig } from '@api/common';
import { S3StorageAdapter, contentDisposition, objectKey } from '@api/storage';

/**
 * The three declarations that need a **real** bucket, and the one behaviour the
 * in-memory adapter can never model.
 *
 * These were unimplemented for the whole life of the project with the note "the
 * S3 adapter is written and exercised only through its in-memory twin". That is
 * no longer true: `docker-compose.test.yml` runs MinIO, so the presigned PUT's
 * signature, the `HeadObject`, the ranged read and `Content-Disposition` all run
 * against something that actually enforces them.
 *
 * The fake cannot cover any of this by construction. A presigned URL's whole
 * point is that the **storage service** validates it — an adapter that returned
 * a URL and then honoured whatever was sent to it would pass every test here
 * while proving the opposite of what they assert.
 */
const BUCKET_ENV = {
  DATABASE_URL: 'postgresql://unused',
  JWT_ACCESS_SECRET: 'not-used-by-this-suite-000',
  JWT_REFRESH_SECRET: 'not-used-by-this-suite-001',
  SEED_USERS: '[]',
  AWS_REGION: 'us-east-1',
  S3_BUCKET: 'dataroom',
  S3_ENDPOINT: 'http://localhost:9000',
  AWS_ACCESS_KEY_ID: 'dataroom',
  AWS_SECRET_ACCESS_KEY: 'dataroom-secret',
} satisfies NodeJS.ProcessEnv;

let storage: S3StorageAdapter;
let config: AppConfig;

beforeAll(() => {
  config = loadConfig(BUCKET_ENV);
  // The **real** adapter, not the one `createTestApp` binds. Everything else in
  // the integration suite runs against the in-memory twin on purpose; this file
  // is the exception, and it is the reason the twin is trustworthy elsewhere.
  storage = new S3StorageAdapter(config);
});

const PDF = Buffer.from('%PDF-1.7\nsmall but genuine\n%%EOF');

function keyFor(): string {
  return objectKey(randomUUID(), randomUUID());
}

describe('a real bucket', () => {
  it('API-STORAGE-008 a presigned PUT rejects a body whose content type differs from the signature', async () => {
    const key = keyFor();
    const presigned = await storage.presignPut(key, 'application/pdf', PDF.byteLength);

    /**
     * The signature covers `Content-Type`, so sending a different one is not a
     * mismatch the *application* catches — the storage service refuses it.
     *
     * That is what makes the client's declaration at `/uploads/init` binding
     * rather than advisory: a browser cannot upload something other than what it
     * said it would, whatever the client-side code does.
     */
    const wrongType = await fetch(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: new Uint8Array(PDF),
    });
    expect(wrongType.ok, 'a mismatched content type must be refused').toBe(false);
    expect(wrongType.status).toBe(403);

    // The same bytes with the signed type go through, so the refusal above is
    // about the header rather than about anything else being wrong.
    const rightType = await fetch(presigned.url, {
      method: 'PUT',
      headers: presigned.headers,
      body: new Uint8Array(PDF),
    });
    expect(rightType.ok, await rightType.text()).toBe(true);
  });

  it('API-STORAGE-009 a presigned PUT rejects a body larger than the signed length', async () => {
    const key = keyFor();
    const presigned = await storage.presignPut(key, 'application/pdf', PDF.byteLength);

    /**
     * `exactBytes`, not `maxBytes`, and this is the declaration that shows why:
     * a presigned PUT signs a `Content-Length` **value** and cannot express a
     * range at all. So the size limit is enforced at `/uploads/init` against
     * `MAX_FILE_SIZE`, and the authoritative size is read back from
     * `HeadObject` at `/complete` — because this is all the transport can do.
     */
    const oversized = Buffer.concat([PDF, Buffer.alloc(1024, 0x41)]);
    const response = await fetch(presigned.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: new Uint8Array(oversized),
    });

    expect(response.ok, 'a body longer than the signed length must be refused').toBe(false);

    // And nothing was stored, so a rejected upload cannot leave a partial object
    // for `/complete` to accept.
    expect(await storage.head(key)).toBeNull();
  });

  it('API-STORAGE-010 unsigned access to the bucket is denied', async () => {
    const key = keyFor();
    const presigned = await storage.presignPut(key, 'application/pdf', PDF.byteLength);
    await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: new Uint8Array(PDF) });

    // The object exists and is readable *with* a signature.
    const signed = await storage.presignGet(key, 60, 'report.pdf');
    expect((await fetch(signed)).ok).toBe(true);

    /**
     * The same object without one is refused.
     *
     * This is the assumption every other decision rests on: the presigned URL is
     * the entire authorization, which is why it is short-lived, why it is never
     * logged, and why the app's own bearer token must never be sent to this
     * host. A publicly-readable bucket would make all of that decorative.
     */
    const unsigned = signed.split('?')[0] ?? '';
    const anonymous = await fetch(unsigned);
    expect(anonymous.ok, 'the bucket must not be publicly readable').toBe(false);
    expect(anonymous.status).toBe(403);

    // Writing without a signature is refused too.
    const write = await fetch(unsigned, { method: 'PUT', body: 'anything at all' });
    expect(write.ok, 'the bucket must not be publicly writable').toBe(false);
  });

  it('API-STORAGE-014 the download carries the display name and an inline disposition only for a PDF', async () => {
    const key = keyFor();
    const presigned = await storage.presignPut(key, 'application/pdf', PDF.byteLength);
    await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: new Uint8Array(PDF) });

    // A non-ASCII name, because the RFC 6266 double form is the part that gets
    // dropped and the part that matters outside English.
    const signed = await storage.presignGet(key, 60, 'Звіт за квартал.pdf');
    const response = await fetch(signed);

    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('inline');
    expect(disposition).toContain("filename*=UTF-8''");
    // The storage key is ids only by design, so without this the file downloads
    // as a uuid.
    expect(decodeURIComponent(disposition)).toContain('Звіт за квартал.pdf');

    // And the rule that does not participate in the upload policy: the same
    // helper says `attachment` for anything that is not a PDF, so a stored
    // `.html` can never be served in a way a browser renders.
    expect(contentDisposition('text/html', 'evil.html')).toContain('attachment');
  });
});
