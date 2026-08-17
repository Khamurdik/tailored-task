# api/storage

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/storage/TODO.md`](../../../../apps/api/src/storage/TODO.md)

Split deliberately: the port contract is testable against the in-memory adapter
with no AWS account, and only a handful of tests need a real bucket.

## Declared tests

### Port behaviour

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-001 | `head` returns null for a missing key rather than throwing | unit | P1 |
| API-STORAGE-002 | Keys follow `rooms/{rootId}/{nodeId}` and never contain a user-supplied filename | security | P0 |
| API-STORAGE-003 | A filename containing `../` cannot influence the generated key | security | P1 |
| API-STORAGE-004 | `presignGet` defaults to a 60-second TTL | unit | P1 |
| API-STORAGE-005 | `presignGet` sets `Content-Disposition` with the current display name | unit | P1 |
| API-STORAGE-011 | `presignGet` sets `inline` only for `application/pdf` | security | P0 |
| API-STORAGE-012 | Every other content type gets `attachment`, under both values of `UPLOAD_FILE_POLICY` | security | P0 |
| API-STORAGE-013 | A display name containing a quote or a newline cannot split the `Content-Disposition` header | security | P1 |

### Fake/real parity and secrecy

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-006 | The in-memory adapter satisfies the same contract suite as the S3 one | unit | P1 |
| API-STORAGE-007 | No log line ever contains a presigned URL | security | P1 |

### Against a real bucket

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-008 | A presigned PUT rejects a body whose content-type differs from the signature | integration | P1 |
| API-STORAGE-009 | A presigned PUT rejects a body larger than the signed length | integration | P1 |
| API-STORAGE-010 | Unsigned access to the bucket is denied | integration | P1 |
| API-STORAGE-014 | A real download carries the display name and is `inline` only for a PDF | integration | P1 |

## Notes
- API-STORAGE-006 is the important one structurally: write the contract suite
  once and run it against both adapters. If the fake and the real thing can
  diverge, every test that uses the fake is worth less.
- API-STORAGE-008..010 need a real bucket. Tag them so `pnpm test` skips them by
  default and CI runs them on demand — a suite that cannot run offline will stop
  being run at all.
- API-STORAGE-011 and 012 are `security`, not `unit`, because of what they
  prevent rather than what they assert. Serving an uploaded `.html` inline from
  the bucket origin executes it as script there, and the web app's CSP — the
  mitigation the whole `localStorage` token decision rests on — does not cover
  that origin. 012 pins the rule to *both* policy values so a later config
  change cannot reopen it.

## Notes
- **API-STORAGE-008..010 were unimplemented for the life of the project** with
  the note that they need a real bucket. They now have one: `docker-compose.test.yml`
  runs MinIO, and `S3_ENDPOINT` points the adapter at it.
- **API-STORAGE-008 failed on its first run, and the bug was in a comment.**
  `presignPut`'s doc claimed `ContentType` was pinned into the signature; the
  emitted `X-Amz-SignedHeaders` was `content-length;host`, so it was not. A
  browser could declare `application/pdf` at `/uploads/init` and PUT anything.
  Nothing downstream relied on the claim — `/complete` reads the size and type
  from `HeadObject` and checks the leading bytes — so this was defence in depth
  rather than an open hole, but a comment asserting a property the code lacks is
  worse than no comment. `signableHeaders` makes it true.
- The in-memory adapter cannot cover this group **by construction**: a presigned
  URL's whole point is that the storage service validates it, and a fake that
  honoured whatever was sent to it would pass these tests while proving the
  opposite of what they assert.
