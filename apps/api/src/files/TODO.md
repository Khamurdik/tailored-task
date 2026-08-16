# files — L3

## Purpose
Orchestrates the upload lifecycle. The only module that knows both what a node
is and what a bucket is.

## Owns
The `pending → active` transition and its failure modes.

## Public surface
- `FilesController`: `/uploads/init`, `/uploads/:id/complete`, `/uploads/:id/abort`,
  `/nodes/:id/content-url`
- `FilesService.reapPending(olderThan)` → `{ scanned, deleted }` — called by
  `jobs`, which records the counts as the run's result

## Depends on
`common`, `nodes`, `storage`, `access` (guards).

## Must not depend on
`sharing`, `search`.

## Responsibilities
- [ ] `POST /uploads/init`
  - [ ] Validate size against `MAX_FILE_SIZE` and declared content type
  - [ ] Resolve the name conflict and **insert the node row as `pending` now** —
        the unique index then protects the name for the whole upload window
  - [ ] Return `{ nodeId, uploadUrl, finalName }`
- [ ] `POST /uploads/:id/complete`
  - [ ] `HeadObject` to verify the object exists
  - [ ] Take `size_bytes` and `content_type` **from S3**, never from the client
  - [ ] Verify magic bytes `%PDF-` if enforcing PDF-only
  - [ ] Flip to `active`, bump ancestor rollups
- [ ] `POST /uploads/:id/abort` — best-effort cleanup on user cancel
- [ ] `GET /nodes/:id/content-url` — permission-checked, 60s presigned GET
- [ ] `reapPending` — delete `pending` nodes older than 1h, returning the counts
      so a job run reports what it actually did rather than just "succeeded"

## The four states
Only one is the happy path. Handle all four explicitly.

| State | Cause | Handling |
| --- | --- | --- |
| Node pending, no object | Tab closed mid-upload | Reaper, 1h |
| Object, no node | `/complete` never called | S3 lifecycle rule on the pending prefix, 1 day |
| Node active, no object | `/complete` called without uploading | `HeadObject` in `/complete` |
| Node deleted, object retained | Normal delete | Correct — keep it; this is what makes restore and versioning possible |

## Invariants
- Client-reported size and content type are advisory only; S3 is authoritative.
- Soft-deleting a node never deletes the S3 object.
- Never delete an object referenced by any file version.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/files/TODO.md`](../../../../tests/suites/api/files/TODO.md) and implemented there — never in this module's folder.
- [ ] `/complete` without an upload → 400, node stays pending
- [ ] `/complete` with a size differing from the client's claim → the S3 value is stored
- [ ] Non-PDF bytes with a PDF content type → rejected
- [ ] Reaper removes a stale pending node and frees its name
- [ ] 10 concurrent inits for the same name → 10 distinct names

## Done when
20 files drag-dropped at once all land, with the name conflicts resolved and no
orphans in either direction.
