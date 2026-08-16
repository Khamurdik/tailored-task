# storage — L1

## Purpose
The blob storage adapter. Issues presigned URLs and inspects objects. Knows
nothing about the tree, users, or the database.

## Owns
The S3 bucket and every credential that touches it.

## Public surface
```ts
export const STORAGE = Symbol('STORAGE');

export interface StoragePort {
  presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedPut>;
  presignGet(key: string, ttlSeconds: number, filename: string): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string } | null>;
  delete(key: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}
```

## Depends on
`common` (config only).

## Must not depend on
`nodes`, `files`, Prisma. This module must be swappable for a local-disk
implementation in tests without touching a single caller.

## Responsibilities
- [ ] `S3StoragePort` implementation using `@aws-sdk/client-s3` and
      `@aws-sdk/s3-request-presigner`
- [ ] Key scheme: `rooms/{rootId}/{nodeId}/{versionId}` — never a user-supplied
      filename, so key collisions and path traversal are impossible by construction
- [ ] Pin `Content-Type` and `Content-Length` into the PUT signature so a client
      cannot upload something other than what it declared
- [ ] `presignGet` sets `Content-Disposition: inline` with the current display
      name, so the browser renders the PDF and the download keeps the right name
- [ ] TTL for GET defaults to **60 seconds**
- [ ] `InMemoryStoragePort` for tests

## Invariants
- A presigned GET cannot be revoked once issued. The 60s TTL bounds the
  exposure window; that is the mitigation and it is a real limitation worth
  writing down in the README rather than pretending away.
- Never log a presigned URL — the signature is a bearer credential.

## Console prerequisites
Bucket with Block Public Access **on**; CORS allowing `PUT, GET, HEAD` from the
web origin and `http://localhost:5173`, exposing `ETag`; IAM policy scoped to
`s3:PutObject, GetObject, DeleteObject, HeadObject` on `arn:…:bucket/*` only;
lifecycle rule aborting incomplete multipart uploads after 1 day.

## Tests
- [ ] Presigned PUT rejects a body whose content-type differs from the signature
      (integration, against a real bucket, run once by hand)
- [ ] `head` returns null for a missing key rather than throwing

## Done when
A file can be PUT from a browser and GET back through a signed URL, with the
bucket denying all unsigned access.
