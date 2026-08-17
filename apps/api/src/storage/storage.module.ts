import { Module } from '@nestjs/common';

import { InMemoryStorageAdapter } from './in-memory-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';
import { STORAGE } from './storage.port';

/**
 * L1. The bucket, behind a port.
 *
 * Callers inject `STORAGE`, never a concrete adapter — which is what lets the
 * integration suite bind `InMemoryStorageAdapter` in the same slot without
 * touching a line of calling code.
 */
@Module({
  providers: [{ provide: STORAGE, useClass: S3StorageAdapter }, InMemoryStorageAdapter],
  exports: [STORAGE],
})
export class StorageModule {}
