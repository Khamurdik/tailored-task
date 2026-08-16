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
  - [ ] Enforce `UPLOAD_FILE_POLICY` — see below. Under `pdf-only`, read the
        first bytes of the object and reject anything not starting `%PDF-`
  - [ ] Flip to `active`, bump ancestor rollups
- [ ] `POST /uploads/:id/abort` — best-effort cleanup on user cancel
- [ ] `GET /nodes/:id/content-url` — permission-checked, 60s presigned GET
- [ ] `reapPending` — delete `pending` nodes older than 1h, returning the counts
      so a job run reports what it actually did rather than just "succeeded"

## File type policy — enforced, and switchable

`UPLOAD_FILE_POLICY` is a validated config value with two settings:

| Value | Behaviour |
| --- | --- |
| `pdf-only` | **Default.** `/complete` reads the object's leading bytes and rejects anything that does not start `%PDF-`. The node is left `pending` for the reaper and the caller gets 415 `UNSUPPORTED_FILE_TYPE`. |
| `all-files` | Any type is accepted. Nothing else changes. |

### Why this is a toggle and not a constant

The product is PDF-shaped — the viewer is a PDF viewer — so `pdf-only` is the
setting the system is designed around, and it is the default so that an
unconfigured deployment is the safe one. The toggle exists because "can it hold
other documents" is a product question a data room will eventually be asked, and
the answer should be a config change rather than a code change.

### The rule the toggle must never reach

**`Content-Disposition` is decided by the object's actual content type, not by
the policy.** Only `application/pdf` is ever served `inline`; everything else is
served `attachment`. This is specified in `storage/TODO.md` and is deliberately
*outside* the toggle.

The reason is a chain that only exists when the three parts are read together:
uploads are served from the S3 origin, an `inline` disposition makes the browser
render rather than download, and the viewer puts that URL in an `<iframe>`.
Under `all-files`, an uploaded `.html` or `.svg` would then execute as script on
the S3 origin — and the app's CSP, which is the mitigation the whole
`localStorage` token decision rests on (`auth/TODO.md`), does not apply to that
origin. Flipping a config value must not be able to open a stored-XSS path into
the session token, so the disposition rule does not participate in the toggle.

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
- ~~Never delete an object referenced by any file version.~~ Dropped with the
  `{versionId}` key segment — there is no versions table for it to refer to.
  Reinstate both together if versioning is ever built.
- Type enforcement reads the object's **bytes**, never the declared content
  type. A client that declares `application/pdf` and uploads HTML is the case
  this exists for.
- No value of `UPLOAD_FILE_POLICY` causes non-PDF bytes to be served `inline`.

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
