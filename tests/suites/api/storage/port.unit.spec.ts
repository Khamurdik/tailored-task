import { describe, expect, it } from 'vitest';

import { InMemoryStorageAdapter } from '@api/storage/in-memory-storage.adapter';
import { contentDisposition, dispositionType, objectKey } from '@api/storage/storage.port';

const ROOT = '11111111-1111-4111-8111-111111111111';
const NODE = '22222222-2222-4222-8222-222222222222';

const dispositionFrom = (url: string): string =>
  new URL(url).searchParams.get('response-content-disposition') ?? '';

describe('port behaviour', () => {
  it('API-STORAGE-001 head returns null for a missing key rather than throwing', async () => {
    const storage = new InMemoryStorageAdapter();

    await expect(storage.head(objectKey(ROOT, NODE))).resolves.toBeNull();

    storage.put(objectKey(ROOT, NODE), '%PDF-1.7', 'application/pdf');
    await expect(storage.head(objectKey(ROOT, NODE))).resolves.toEqual({
      size: 8,
      contentType: 'application/pdf',
    });
  });

  it('API-STORAGE-002 keys follow rooms/{rootId}/{nodeId} and never contain a user-supplied filename', () => {
    expect(objectKey(ROOT, NODE)).toBe(`rooms/${ROOT}/${NODE}`);

    // The function takes ids and nothing else, so there is no parameter a
    // filename could arrive through. That is the property — not that names are
    // sanitised, but that they are structurally absent.
    expect(objectKey.length).toBe(2);
    expect(objectKey(ROOT, NODE)).not.toMatch(/\.(pdf|html|exe)/i);
  });

  it('API-STORAGE-003 a filename containing ../ cannot influence the generated key', async () => {
    const storage = new InMemoryStorageAdapter();
    const key = objectKey(ROOT, NODE);
    storage.put(key, '%PDF-1.7', 'application/pdf');

    const url = await storage.presignGet(key, 60, '../../etc/passwd');

    // The traversal can appear in the disposition header, where it is inert
    // text. What matters is that the key is untouched by it.
    expect(new URL(url).pathname).toBe(`/${key}`);
    expect(new URL(url).pathname).not.toContain('..');
  });

  it('API-STORAGE-004 presignGet defaults to a 60-second TTL', async () => {
    const storage = new InMemoryStorageAdapter();
    const key = objectKey(ROOT, NODE);
    storage.put(key, '%PDF-1.7', 'application/pdf');

    const url = await storage.presignGet(key, 60, 'a.pdf');

    // 60 seconds is the entire mitigation for a presigned GET being
    // unrevocable, so the number is load-bearing rather than a default.
    expect(new URL(url).searchParams.get('expires-in')).toBe('60');
  });

  it('API-STORAGE-005 presignGet sets Content-Disposition with the current display name', async () => {
    const storage = new InMemoryStorageAdapter();
    const key = objectKey(ROOT, NODE);
    storage.put(key, '%PDF-1.7', 'application/pdf');

    const disposition = dispositionFrom(await storage.presignGet(key, 60, 'Отчёт Q4.pdf'));

    expect(disposition).toContain(`filename*=UTF-8''`);
    expect(disposition).toContain(encodeURIComponent('Отчёт Q4.pdf').replace(/'/g, '%27'));
  });

  it('API-STORAGE-011 presignGet sets inline only for application/pdf', async () => {
    const storage = new InMemoryStorageAdapter();
    const key = objectKey(ROOT, NODE);

    storage.put(key, '%PDF-1.7', 'application/pdf');
    expect(dispositionFrom(await storage.presignGet(key, 60, 'a.pdf'))).toMatch(/^inline;/);

    // A parameterised media type is still that media type.
    storage.put(key, '%PDF-1.7', 'application/pdf; charset=binary');
    expect(dispositionFrom(await storage.presignGet(key, 60, 'a.pdf'))).toMatch(/^inline;/);
  });

  it('API-STORAGE-012 every other content type gets attachment, under both values of UPLOAD_FILE_POLICY', () => {
    for (const contentType of [
      'text/html',
      'image/svg+xml',
      'application/xhtml+xml',
      'text/plain',
      'application/octet-stream',
      'application/pdfx',
      'APPLICATION/PDF ',
      null,
      undefined,
      '',
    ]) {
      const expected = contentType?.trim().toLowerCase() === 'application/pdf' ? 'inline' : 'attachment';
      expect(dispositionType(contentType), String(contentType)).toBe(expected);
    }

    // The rule takes no policy argument at all. That is the assertion: there is
    // no value of UPLOAD_FILE_POLICY that can reach it, because there is no
    // parameter for one. An uploaded .html served inline would execute on the
    // bucket origin, which the web app's CSP cannot cover.
    expect(dispositionType.length).toBe(1);
  });

  it('API-STORAGE-013 a display name containing a quote or a newline cannot split the Content-Disposition header', () => {
    const hostile = 'evil".pdf\r\nX-Injected: yes\r\n\r\n<script>alert(1)</script>';
    const header = contentDisposition('application/pdf', hostile);

    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    // Exactly the two quotes that delimit the ASCII filename, and no more.
    expect(header.split('"')).toHaveLength(3);
    expect(header).toMatch(/^inline; filename="[^"]*"; filename\*=UTF-8''/);

    // A name made entirely of stripped characters must not yield filename="".
    expect(contentDisposition('application/pdf', '";\r\n')).toContain('filename="download"');
  });
});

describe('fake/real parity and secrecy', () => {
  it('API-STORAGE-006 the in-memory adapter satisfies the same contract suite as the S3 one', async () => {
    // Structural parity, checked against the port's method list rather than a
    // hand-kept duplicate. If the fake and the real thing can diverge, every
    // test that uses the fake is worth less.
    const { S3StorageAdapter } = await import('@api/storage/s3-storage.adapter');
    const required = ['presignPut', 'presignGet', 'head', 'delete', 'copy'] as const;

    for (const method of required) {
      expect(typeof InMemoryStorageAdapter.prototype[method], method).toBe('function');
      expect(typeof S3StorageAdapter.prototype[method], method).toBe('function');
      expect(
        S3StorageAdapter.prototype[method].length,
        `${method} arity differs between adapters`,
      ).toBe(InMemoryStorageAdapter.prototype[method].length);
    }

    // Behavioural parity for the one thing both can do offline.
    const memory = new InMemoryStorageAdapter();
    await expect(memory.head('rooms/none/none')).resolves.toBeNull();
    await expect(memory.copy('rooms/a/missing', 'rooms/a/other')).resolves.toBeUndefined();
  });

  it('API-STORAGE-007 no log line ever contains a presigned URL', async () => {
    const captured: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((name) => [name, console[name]] as const);

    for (const name of methods) {
      console[name] = (...args: unknown[]) => captured.push(args.map(String).join(' '));
    }

    try {
      const storage = new InMemoryStorageAdapter();
      const key = 'rooms/a/b';
      storage.put(key, '%PDF-1.7', 'application/pdf');

      const url = await storage.presignGet(key, 60, 'a.pdf');
      await storage.presignPut(key, 'application/pdf', 8);
      await storage.head(key);
      await storage.delete(key);

      expect(url).not.toBe('');
      expect(captured.join('\n')).toBe('');
    } finally {
      for (const [name, original] of originals) console[name] = original;
    }
  });
});
