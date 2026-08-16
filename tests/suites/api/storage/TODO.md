# api/storage

> Declarations only. Nothing here is implemented — see [`tests/TODO.md`](../../../TODO.md).

**Traces** [`apps/api/src/storage/TODO.md`](../../../../apps/api/src/storage/TODO.md)

Split deliberately: the port contract is testable against the in-memory adapter
with no AWS account, and only a handful of tests need a real bucket.

## Declared tests

### Port behaviour

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-001 | `head` returns null for a missing key rather than throwing | unit | P0 |
| API-STORAGE-002 | Keys follow `rooms/{rootId}/{nodeId}/{versionId}` and never contain a user-supplied filename | security | P0 |
| API-STORAGE-003 | A filename containing `../` cannot influence the generated key | security | P0 |
| API-STORAGE-004 | `presignGet` defaults to a 60-second TTL | unit | P0 |
| API-STORAGE-005 | `presignGet` sets `Content-Disposition: inline` with the current display name | unit | P1 |

### Fake/real parity and secrecy

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-006 | The in-memory adapter satisfies the same contract suite as the S3 one | unit | P0 |
| API-STORAGE-007 | No log line ever contains a presigned URL | security | P0 |

### Against a real bucket

| ID | Behaviour | Kind | Pri |
| --- | --- | --- | --- |
| API-STORAGE-008 | A presigned PUT rejects a body whose content-type differs from the signature | integration | P1 |
| API-STORAGE-009 | A presigned PUT rejects a body larger than the signed length | integration | P1 |
| API-STORAGE-010 | Unsigned access to the bucket is denied | integration | P1 |

## Notes
- API-STORAGE-006 is the important one structurally: write the contract suite
  once and run it against both adapters. If the fake and the real thing can
  diverge, every test that uses the fake is worth less.
- API-STORAGE-008..010 need a real bucket. Tag them so `pnpm test` skips them by
  default and CI runs them on demand — a suite that cannot run offline will stop
  being run at all.
