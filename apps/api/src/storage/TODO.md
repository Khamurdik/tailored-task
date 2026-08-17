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
  presignPut(key: string, contentType: string, exactBytes: number): Promise<PresignedPut>;
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
- [x] `S3StoragePort` implementation using `@aws-sdk/client-s3` and
      `@aws-sdk/s3-request-presigner`
- [x] Key scheme: `rooms/{rootId}/{nodeId}` — never a user-supplied filename, so
      key collisions and path traversal are impossible by construction.
      **`{versionId}` was removed.** No module owns a versions table and no
      responsibility creates one, so the segment was a placeholder for a feature
      that does not exist — and `files`' "never delete an object referenced by
      any file version" had nothing to check against. Add the segment back in
      the same change that adds the table, not before
- [x] Pin `Content-Type` and `Content-Length` into the PUT signature so a client
      cannot upload something other than what it declared. Note that a signed
      `Content-Length` is an **exact** value, not a ceiling — a presigned PUT
      cannot express a size range at all (that needs a POST policy). Hence
      `exactBytes`, not `maxBytes`. The size *limit* is enforced at
      `/uploads/init` against `MAX_FILE_SIZE`, and the authoritative size comes
      from `HeadObject` at `/complete`
- [x] `presignGet` sets `Content-Disposition` with the current display name, so
      a download keeps the right name. The disposition **type** is decided by
      the object's stored content type, not by the caller:
      - `application/pdf` → `inline`, so the browser renders it
      - anything else → `attachment`, always
      This does not vary with `UPLOAD_FILE_POLICY`; see `files/TODO.md`. Serving
      user-uploaded HTML or SVG inline from the bucket origin is a stored-XSS
      path straight to the session token, and the web app's CSP cannot reach
      that origin to stop it.
- [x] Quote and escape the filename per RFC 6266 (`filename*=UTF-8''…`). A name
      containing `"` or a newline must not be able to split the header
- [x] TTL for GET defaults to **60 seconds**
- [x] `InMemoryStoragePort` for tests

## Invariants
- A presigned GET cannot be revoked once issued. The 60s TTL bounds the
  exposure window; that is the mitigation and it is a real limitation worth
  writing down in the README rather than pretending away.
- Never log a presigned URL — the signature is a bearer credential.
- Only `application/pdf` is ever served `inline`. No config value changes this.

## Console prerequisites
Bucket with Block Public Access **on**; CORS allowing `PUT, GET, HEAD` from the
web origin and `http://localhost:5173`, exposing `ETag`; IAM policy scoped to
`s3:PutObject, GetObject, DeleteObject, HeadObject` on `arn:…:bucket/*` only;
lifecycle rule aborting incomplete multipart uploads after 1 day.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/storage/TODO.md`](../../../../tests/suites/api/storage/TODO.md) and implemented there — never in this module's folder.
- [ ] Presigned PUT rejects a body whose content-type differs from the signature
      (integration, against a real bucket, run once by hand)
- [ ] `head` returns null for a missing key rather than throwing

## Done when
A file can be PUT from a browser and GET back through a signed URL, with the
bucket denying all unsigned access.
