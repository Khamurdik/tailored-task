import { Injectable } from '@nestjs/common';

import {
  contentDisposition,
  type ObjectHead,
  type PresignedPut,
  type StoragePort,
} from './storage.port';

interface StoredObject {
  body: Buffer;
  contentType: string;
}

/**
 * The test adapter.
 *
 * It is in `src/` rather than in the test project on purpose: it is part of
 * this module's public surface, `tests/src/support/app.ts` binds `STORAGE` to
 * it, and a fake that lives beside the real thing is far more likely to be
 * updated when the port changes.
 *
 * The URLs it returns are not real and are not fetchable. What the contract
 * suite asserts about them — the disposition, the TTL, the key shape — is
 * encoded in the URL so both adapters can be checked the same way. If the fake
 * and the real thing can diverge, every test that uses the fake is worth less.
 */
@Injectable()
export class InMemoryStorageAdapter implements StoragePort {
  private readonly objects = new Map<string, StoredObject>();

  presignPut(key: string, contentType: string, exactBytes: number): Promise<PresignedPut> {
    const url = new URL(`memory://bucket/${key}`);
    url.searchParams.set('method', 'PUT');
    url.searchParams.set('content-type', contentType);
    url.searchParams.set('content-length', String(exactBytes));

    return Promise.resolve({
      url: url.toString(),
      headers: { 'Content-Type': contentType, 'Content-Length': String(exactBytes) },
    });
  }

  presignGet(key: string, ttlSeconds: number, filename: string): Promise<string> {
    const stored = this.objects.get(key);
    const url = new URL(`memory://bucket/${key}`);
    url.searchParams.set('expires-in', String(ttlSeconds));
    url.searchParams.set(
      'response-content-disposition',
      contentDisposition(stored?.contentType, filename),
    );
    return Promise.resolve(url.toString());
  }

  head(key: string): Promise<ObjectHead | null> {
    const stored = this.objects.get(key);
    return Promise.resolve(
      stored ? { size: stored.body.byteLength, contentType: stored.contentType } : null,
    );
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  copy(from: string, to: string): Promise<void> {
    const stored = this.objects.get(from);
    if (stored) this.objects.set(to, { ...stored, body: Buffer.from(stored.body) });
    return Promise.resolve();
  }

  /**
   * Test-only. Stands in for the browser's direct PUT, which never goes through
   * the API in production and so has no port method.
   */
  put(key: string, body: Buffer | string, contentType: string): void {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  /** Test-only. Reads bytes back so `/complete`'s magic-byte check can be exercised. */
  get(key: string): Buffer | null {
    return this.objects.get(key)?.body ?? null;
  }

  reset(): void {
    this.objects.clear();
  }
}
