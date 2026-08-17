# Implementation log

A running record of what was built, in order, and **what got in the way**.

This is the third of the three status documents and the only one that is
chronological. The other two answer different questions:

| Document | Question it answers |
| --- | --- |
| [`HANDOFF-IMPLEMENTATION.md`](HANDOFF-IMPLEMENTATION.md) | *What was built*, and what changed on contact |
| [`HANDOFF.md`](HANDOFF.md) §3 | *Why* is it like this — the decision log |
| [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) | *Where* is the code now |
| **this file** | *What happened*, in what order, and what blocked it |

Blockers are the point. A status document naturally records the end state, which
is the version where nothing was ever hard — so the specific ways the work
stalled, and what unblocked them, live here instead. Each one is labelled with
whether it cost a design decision, a spec change, or just time.

---

## Session 3 — `tree`, `sharing`, `links`

*2026-08-17. Starting point: 556 declared / 156 implemented, 36 of 83 `P0`.*

### Phase A — `tree` (the tree's HTTP surface)

**Goal.** Put `/nodes/*` behind `NodeAccessGuard`, which until now had never run
in a real request.

**Order deviation, decided before starting.** `IMPLEMENTATION-STATUS.md` §8 had
`sharing` + `links` first, on the grounds that they would give the guard its
first controllers. They cannot give it a *readable* one: every route in `sharing`
is `@RequireAccess('own')`, which a share token can never satisfy, so
`API-SHARING-002` — the scoping test a reviewer tries by hand — has nothing to
point at until `GET /nodes/:id` exists. `tree` moved ahead of both.

**Built.** `NodesRepository.listChildren` / `listRooms` / `findManyByIds`;
`NodesService.listChildren` and a rewritten `breadcrumbs`; the `tree` module with
nine routes; `NodeAccessResolver` extracted from the guard; `app.setup.ts`.

#### Blockers

**1. The tree's controller had nowhere to live.** *(design decision — escalated)*
`nodes` is L1 and its spec says "Must not depend on: `access`". A controller
needs `@RequireAccess`, which is L2. Both obvious fixes break something stated:
putting the controller in `nodes` inverts the layer graph, and relaxing the rule
for controllers retires the most-repeated claim in the repository. Resolved by
asking rather than guessing — a new L3 module, `tree`, which is the pattern
`sharing` and `files` already follow (a node-scoped route belongs to the L3
module that owns what it returns).

**2. Two routes a guard structurally cannot protect.** *(design decision —
escalated)* `POST /nodes/folders` names its parent in the request **body**, and
`PATCH /nodes/:id/parent` names its destination there. `NodeAccessGuard` reads
route parameters, so folder creation was open to any authenticated caller in
anybody's room, and a move could land a node in a room the caller has no access
to. Two options — re-route so the guard can see it, or check in the controller.
Chose the controller check, and extracted `NodeAccessResolver` so the check and
the guard are two callers of one implementation rather than two implementations.

**3. `ORDER BY "type"` sorted by the wrong column.** *(cost: ~20 min)* The
listing selects `"type"::text AS "type"`, and Postgres resolves an unqualified
`ORDER BY` name against the **output** columns first — so it sorted the text
label and put `'file'` before `'folder'` alphabetically, exactly reversing the
rule the enum's declaration order exists to provide. Caught by `API-NODES-015` on
its first run. Fixed by qualifying as `"nodes"."type"`; a qualified reference can
only mean the input column.

**4. Every cursor the system produced was invalid under its own contract.**
*(cost: ~40 min, plus a contract change)* `encodeCursor` emitted
`base64url(payload).base64url(hmac)` and `CursorSchema` is `z.base64url()` — `.`
is not in that alphabet. A client parsing the response would have rejected the
page it had just been handed. Nothing caught it because nothing had ever produced
a cursor: `API-COMMON-010` round-trips the encoder against the decoder, and two
functions that agree with each other can both disagree with the schema. The
signature is appended as raw bytes and the whole thing encoded once now.
Declared as `API-COMMON-018` so it cannot regress.

**5. `CursorSchema`'s length bound was too small for a legitimate cursor.**
*(found while fixing 4)* 512 characters, against a cursor carrying a name of up
to 255 *characters* — ~1020 bytes in Cyrillic or CJK, so ~1500 characters
encoded. Pagination would have failed on page two, only in some folders, only in
some languages. The bound is derived from `MAX_NAME_LENGTH` now rather than
picked.

**6. `listSubtree` returned `undefined` for every mapped field.** *(cost: minutes
— found by reading)* `SELECT *` through `$queryRaw` yields the *database's*
column names, so `root_id` never became `rootId`. Invisible because its only
caller reads `depth`, spelled the same either way. Fixed while adding the
explicit column list the new queries needed.

**7. Query parameters are strings; `PageQuerySchema` types `limit` as an int.**
*(cost: minutes)* Every paginated request 400'd. Coerced at the HTTP boundary
rather than in `packages/shared`, because the schema is shared with a client that
builds the query from real numbers — making it coerce would mean the client's own
validation started accepting `limit: "banana"` too.

**Result.** 564 declared / 168 implemented, 41 of 87 `P0`. Eight new
declarations, seven of them about the request pipeline.

### Phase B — `sharing` and `links`

**Goal.** Close credential → grant → node. Issue links, revoke them, and resolve
them anonymously through one indistinguishable failure.

**Built.** `SharingService` with both event listeners; two controllers, split so
that "every route requires an owner" needs no carve-out; `LinksController`;
`SharesRepository.findLiveByCredential` and `ShareCodec.credentialColumn`.

#### Blockers

**8. Breadcrumbs named every folder above a share.** *(cost: ~30 min, plus a new
`P0`)* `NodeAccessGuard` resolves a visitor's *role* correctly and has nothing to
say about what a response may contain, so the trail was built from the room root:
a visitor given `Q4` saw `Project Meridian / Diligence / Q4`. Nothing in the
permission model was wrong — the leak was in presentation, which is why no
existing test was ever going to find it. `AccessContext` grew `grantNodeId`, read
out of the grant the guard had already resolved, so it costs no extra query.
Declared as `API-SHARING-021`.

**9. `@RequireAuth()` answered 401 where this system answers 404.** *(cost: ~15
min)* A share visitor attempting to re-share learned the route existed and their
credential was the wrong kind — a different answer than a signed-in stranger
gets, which is precisely the distinction the 404-not-403 rule exists to erase.
Removed from both sharing controllers; `@RequireAccess('own')` already excluded
them, through the single 404. `API-SHARING-020` keeps it true for routes added
later.

**10. `CreatedShareSchema` could not describe a `user` grant.** *(spec change)*
`token` was `z.string()`, the database forbids a token on a user grant
(`shares_kind_shape`), and the placeholder data layer returned `''` to bridge the
gap. An empty string is not a token — a client checking `if (token)` gets the
right answer by accident and one rendering it shows an empty "copy this link"
box. Now nullable.

**11. Rate limiting could not be switched off for a test.** *(cost: ~45 min —
the most time lost this session, and to a false start)* The links suite makes
more than 20 resolve calls; the route's limit is 20/minute. Both
`overrideGuard(ThrottlerGuard)` and `overrideProvider(APP_GUARD)` silently do
nothing — the guard is registered under `APP_GUARD`, and Nest collects enhancer
providers into `ApplicationConfig` while scanning modules, not through the
injector an override touches. **The false start is worth recording**: the first
fix made the limits configurable through `AppConfig`, which is defensible
engineering and was entirely driven by a test problem. It was reverted. The real
fix replaces `ThrottlerStorage`, which is an ordinary injectable — the guard, the
decorators and the 429 path all still run, with only the counter neutered.

**12. Concurrent supertest calls race.** *(cost: ~10 min)* `request(server)`
calls `listen()` on the server it is handed, so a `Promise.all` of requests dies
with `ECONNRESET`. `API-LINKS-004` compares six responses and had to drive them
sequentially.

**13. The coverage gate read `SHA-256` in a test title as a declaration id.**
*(cost: minutes)* The id pattern `^[A-Z]+(-[A-Z0-9]+)*-\d{3}$` matches it
exactly, so a test titled "…the stored value is a SHA-256 of the token…"
registered as an implementation of a declaration called `SHA-256`. The gate
reported it as "implemented but never declared" rather than miscounting, which is
the right way round — loud, not silent. Title reworded; the hole is recorded in
`tests/TODO.md` §4.

**Result.** 566 declared / 210 implemented, 59 of 89 `P0`. `api/sharing` 20/20,
`api/links` 21/23.

### Phase C — `files`

**Goal.** The upload lifecycle: `/uploads/init`, `/complete`, `/abort`,
`/nodes/:id/content-url`, and `reapPending`.

**Built.** `FilesService` and two controllers; `StoragePort.readPrefix` on both
adapters; `NodesRepository.activateFile` / `bumpRollups` / `listStalePending` /
`hardDeletePending` and the service methods over them.

#### Blockers

**14. `StoragePort` has no way to read an object's bytes.** *(spec gap, found
before writing any code)* `files/TODO.md` requires that `/complete` "read the
first bytes of the object and reject anything not starting `%PDF-`" — the case a
client declaring `application/pdf` and uploading HTML exists for. The port
exposes `presignPut`, `presignGet`, `head`, `delete` and `copy`, and none of them
returns bytes. The in-memory adapter has a **test-only** `get()` whose comment
already says "so `/complete`'s magic-byte check can be exercised", so the need was
anticipated and the port method was never added.

Resolved by adding `readPrefix(key, maxBytes)` to the port and to both adapters
(S3 via a ranged `GetObject`). Deliberately a *prefix* read rather than a full
`get`: the check needs five bytes, and a port method that returns a whole object
is one an unrelated caller will eventually use to stream a 50 MiB file through
the API — which is the thing presigned URLs exist to avoid.

**15. The node presenter was in the wrong module.** *(cost: minutes — a move)*
`/uploads/:id/complete` answers with a `NodeDetail`, and the mapping lived in
`tree`. `files` importing `tree` is an L3 module importing its own layer — the
exact shape the `sharing`/`links` split exists to prevent. Moved down into
`nodes`, which both already depend on: that module owns the `Node` contract, so
the projection of it onto the wire is part of publishing it, and
`packages/shared` is a schema package rather than a layer so naming it adds no
edge to the graph. The alternative was two copies of one mapping, which is how
`subtreeFiles` ends up null in one response and 0 in another.

**16. Two specs contradicted each other, and only concurrency revealed it.**
*(cost: ~40 min — the real defect of this phase)* `nodes/TODO.md` fixes the
name-conflict retry at "capped at 10 attempts". `files/TODO.md`'s acceptance bar
is "20 files drag-dropped at once all land". Both had been true on paper for
weeks. They cannot both hold: every writer read the same sibling set, computed
the same lowest free suffix, and collided in lockstep, so under twenty-way
contention a request lost ten races and the user got a **409 on an upload that
should simply have been renamed**.

`API-FILES-017` is the test that made them meet, and it is worth noting it is the
module's own "done when" restated — the acceptance bar found the defect that the
seventeen tests before it did not, because they were all single-writer.

Resolved in `NodeNamingService.nextFreeName` rather than by raising the cap,
which would only have moved the number at which it breaks: the first two attempts
stay deterministic, so an ordinary upload still numbers tidily, and from the
third the candidate is drawn from a window that doubles each round. That turns
lockstep collision into a birthday problem over a widening space. The cost is
stated in the code: under heavy contention the numbering has gaps, and gap-free
numbering would require serializing every upload into one folder.

**17. The concurrent-supertest race from blocker 12, again — and this time
there was no workaround.** *(cost: ~20 min)* `API-FILES-017` fires twenty
simultaneous uploads, so "drive them sequentially" was not available: the
concurrency *is* the subject. Fixed at the root instead — the harness now calls
`http.listen(0)` once in `createTestApp`, so supertest reuses the address rather
than racing twenty `listen` calls against one server. Recording this because the
Phase B fix treated a symptom and the symptom came back the moment a test
genuinely needed parallelism.

**Result.** 568 declared / 231 implemented, 64 of 90 `P0`. `api/files` 22/22.

#### A spec change worth reading — Phase C

`nodes/TODO.md` specified the rollups as "maintained by trigger". They are
maintained in application code instead: `files` completes an upload inside a
transaction that already flips the row, so bumping the ancestors there costs
nothing and keeps the arithmetic where a reader will look for it. A trigger would
put half the invariant in the schema and half in `bumpRollups`. The daily
`reconcile-rollups` job is the backstop under either choice — which is the reason
that job exists, and the reason this was a safe change to make rather than a
corner cut.

### Phase D — `api/users` coverage

**Goal.** Close the cheapest documented gap: sixteen declarations, four of them
`P0`, against a module finished in the first session and never covered.

**Built.** `seed.int.spec.ts`, which **runs `node prisma/seed.ts` as a
subprocess** rather than importing its functions, and `provisioning.unit.spec.ts`,
two static scans.

Shelling out is the point rather than an inconvenience. The seeder executes
under Node's type stripping with no compiler — a different execution environment
from every other test in this repo — so importing `upsert` and calling it would
test the logic while skipping the constraint that actually breaks.

#### Blockers

**18. Two declarations described things that are not true.** *(spec corrections,
no code)* `API-USERS-012` declared that `user.created` is emitted once per
inserted row; that event was deleted three sessions ago because the seeder is a
separate process from the bus and it could never have fired. It is the **second**
declaration to outlive its mechanism — `API-SHARING-011` was the first, for the
same reason — and both are now retired rather than deleted, so the numbers stay
unusable and the reasons stay findable.

`API-USERS-001` and `002` were declared `unit` and are about `citext` and NFC
normalization *at the column*, which only a database has. The file-naming rule in
`tests/TODO.md` §1 makes `.unit.spec.ts` mean "no I/O", so the label was deciding
which project would run them. Relabelled `integration`.

**Result.** 567 declared / 247 implemented, 68 of 90 `P0`. `api/users` 15/15.

### Phase E — `jobs`

**Goal.** The last backend module: a job registry, `job_runs` as queryable
objects, five endpoints, and the six scheduled jobs.

**Built.** The `job_runs` table and migration; `JobRegistry`, `JobRunner`,
`JobScheduler`, `JobRunsRepository`, `AdminGuard`, `JobsController`; and the
supporting operations each job needs, added to the module that owns the data
(`FilesService.hardDeleteExpired`, `SharesRepository.purgeExpired`,
`RefreshTokenRepository.purgeExpired`, `NodesRepository.reconcileRollups`).

#### Blockers

**19. The migration nearly dropped a live index.** *(cost: ~15 min — and it would
have been silent)* `prisma migrate dev` generated
`DROP INDEX "refresh_tokens_expires_at"` alongside the new table. That index was
created by hand in `add_refresh_tokens` and never declared in `schema.prisma`, so
Prisma read it as drift — and it is the index `purge-expired-tokens`, the job in
this very phase, is built on.

Worth understanding rather than just fixing: the other hand-written indexes in
this schema survive because they are *partial*, or carry an operator class or an
explicit collation, none of which Prisma can represent — so it ignores them. This
one was a plain single-column btree, which Prisma **can** represent, and a
representable index in the database that the schema does not declare is drift by
definition. Declared in `schema.prisma` now; the regenerated migration renames it
to Prisma's convention instead of dropping it.

The general lesson is uncomfortable: a hand-written index is invisible to Prisma
right up until it is representable, and then it is deletable. Everything that can
be declared in the schema should be.

**20. `cron` was not resolvable.** *(cost: minutes)* The spec calls for
`CronJob.from(...)`, and `cron` is a transitive dependency of
`@nestjs/schedule` — pnpm's strict linking means it is not importable from
`apps/api`. Added as a direct dependency pinned to **exactly** `4.4.0`, the
version `@nestjs/schedule@6.1.3` resolves: a looser pin would put two copies of
`CronJob` in the tree, and `SchedulerRegistry.addCronJob` would be handed an
instance of the class it is not checking against — which fails at registration,
not at import, and reads as a scheduler bug.

**21. A CHECK constraint rejected the startup sweep, correctly.** *(cost: ~10
min)* The sweep used `updateMany` to set the status and `finished_at`, then a
second `UPDATE` to fill `duration_ms`, because `updateMany` cannot compute a
per-row difference between two columns. `job_runs_duration_iff_finished` is
immediate, so the intermediate row — finished, with no duration — was rejected
and the second statement never ran.

Recorded as a blocker but it is really the constraint earning its place, on the
same day it was written. A pair of writes that is only valid once both have
landed leaves invalid rows whenever the second one does not, and "the sweep
half-ran" is precisely the state this table exists to make impossible. Rewritten
as one statement.

#### Two spec corrections

- **`@RequireAuth()` is not used on `/jobs`.** The spec says to guard with it
  *plus* an `is_admin` check. It throws 401, which confirms to an
  unauthenticated caller that an admin surface exists — and the very next line of
  the same spec asks for 404. `AdminGuard` answers 404 for anonymous,
  share-scoped and merely-not-admin callers alike. `API-JOBS-018` pins it.
- **Manual triggers are throttled by IP, not by user.** `@nestjs/throttler`
  tracks by address and a per-user key needs a custom tracker. Written down
  rather than glossed: the practical difference is small when every caller is an
  operator, and it is not what the line asked for.

#### One item deliberately left unticked

`jobs/TODO.md` §5 asks for the API service to be pinned to a single instance
(`minSize: 1`, `maxSize: 1`). **Nothing is deployed**, so it is not done — and it
is the one requirement in that section that lives in infrastructure rather than
code, and the one the startup sweep's correctness actually rests on. Left
unticked rather than quietly counted.

**Result.** 567 declared / 271 implemented, 70 of 90 `P0`. `api/jobs` 24/24.
**The backend is complete**: every module in the layer graph is built, and the
only API suites short of full are the four listed in `IMPLEMENTATION-STATUS.md`
under *Still genuinely open*.

### Phase F — `web/explorer`, first tranche

**Goal.** Make the backend visible. Browse a tree, create, rename, delete, and
render every state — plus `readOnly`, which is the only thing standing between a
share visitor and a delete button.

**Built.** `explorer.api.ts`, `use-explorer.ts`, `Breadcrumbs`, `NodeRow`,
`NameDialog`, `DeleteDialog`, `Explorer`, `RoomsPage` and `FolderPage`, and the
`/` and `/nodes/:id` routes. 32 of the suite's 81 declarations.

**Scope, stated plainly.** This is a first tranche, not the module. What is
*not* built: drag-and-drop move, bulk selection, keyboard navigation, optimistic
create/rename, and the move dialog's shared-destination warning. Each is marked
unticked in `explorer/TODO.md` with a reason rather than left to look finished.

The one worth calling out is **optimistic create and rename**, because the spec
asks for them and an earlier draft of `use-explorer.ts` carried a comment
claiming they were implemented when they were not. Both close on success and let
the shared `MutationCache` invalidate — correct, and a visible flash on a slow
connection. Deferred rather than half-built: an optimistic update whose rollback
is untested is worse than none, and its failure mode is a row that exists only on
the client.

#### Blockers

**22. Every test in the first run asserted against the error state.** *(cost:
~10 min, and it was the system working)* The fixtures used ids like `'f1'`.
`NodeSummarySchema` says `z.uuid()`, and `request()` parses every response
against the shared schema — so the whole page failed to parse, the query
rejected, and thirty tests dutifully found an error alert instead of the thing
they named.

Worth recording as a success rather than an annoyance: this is precisely the
behaviour the response parser exists for. A client that cast `response.data as T`
would have rendered `undefined` into a table cell and the tests would have failed
somewhere three components away from the cause.

**23. The same fix from Phase A rejected a test fixture.** *(cost: minutes)* The
pagination test used `'opaque.cursor-value_1'` as a fake cursor. `CursorSchema`
is `z.base64url()` — the `.` is not in that alphabet — which is the exact defect
found and fixed in blocker 4. Pleasing, in a way: the constraint that caught a
real bug in the server also catches an unrealistic fixture in a test.

**24. Two buttons shared an accessible name.** *(cost: minutes)* The header and
the empty state both said "New folder", so `getByRole('button', { name: 'New
folder' })` matched two elements. The fix is a UI fix rather than a selector fix
— one accessible name per view is a real requirement, not a testing convenience.

#### One security gap found while building

`readOnly` was applied to the row actions and to the header create button, and
the **empty state renders from a different branch** — so every empty folder in a
share view still offered a create button. Nothing about the permission model was
wrong; the server would have refused the request. But the affordance is the
declaration's subject: `readOnly` hides mutating controls so a visitor is not
invited to try. Declared as `WEB-EXPLORER-081`, `P0`, and it is a duplicate of
`-001` only if you think of `readOnly` as one guard rather than as one per
rendering branch.

**Result.** 568 declared / 303 implemented, 72 of 91 `P0`. `web/explorer` 32/81.

### Phase G — `web/uploads`

**Prompted by a bug report, not by the plan.** The user ran Option A, dragged a
file onto the explorer, and nothing happened — because `uploads` did not exist
*and* the explorer's empty state said "drop files here to upload them". The copy
was mine, and advertising a capability that is not there is the one thing this
repo's brief says not to do.

**Built.** `upload-queue.ts` (zustand), `uploads.api.ts`, `use-uploads.ts`,
`UploadDropzone`, `UploadPanel`, wired above the router. 19 of 47 declarations.

#### Blockers

**25. The bytes bypassed the only transport anyone can run.** *(cost: ~25 min —
and it would have shipped)* `uploadBytes` was written with a bare
`XMLHttpRequest`, on the correct reasoning that `fetch` has no upload-progress
event. But the placeholder data layer swaps the **axios adapter**, and the
presigned URL it hands out is `mock://uploads/<id>` — a scheme XHR cannot send
to. So the feature would have worked against a real S3 bucket and failed
silently in `VITE_API_MODE=mock`, which is the only mode that runs today because
no bucket exists.

Fixed with a dedicated axios instance for the transfer, which turns out to be
better on the merits and not merely more testable:

- it carries **no credential** — the app's `api` client attaches a bearer or
  share token to every request, and sending one to a storage host puts a session
  token in someone else's access log; the signature in the URL is the whole
  authorization;
- `onUploadProgress` is axios's wrapper over the same XHR upload event, so the
  progress is still a real byte count rather than a timer;
- `installMockTransport` applies to it, so the fake PUT is answered exactly where
  the real one would be.

The general lesson is the one from blocker 22 in the other direction: a seam that
a test cannot see is a seam that an environment cannot use either.

**26. Two disconnected abort registries.** *(caught by reading, before running)*
The runner kept its abort handles in a `useRef`, and `useCancelUpload` — a
different component, elsewhere in the tree — kept its own module-level map.
Cancelling would have marked an item `cancelled` while its bytes kept going.
Both are module-level now, which is also what makes `retry` able to clear the
started-set.

**27. A test asserted a transient.** *(cost: minutes)* `WEB-UPLOADS-036` checked
that `nodeId` was null after a retry. It is — for one tick, before the runner
picks the item back up and re-initialises. Rewritten to assert the property that
actually matters: a **second** `POST /uploads/init`, because reusing an expired
presigned URL would fail the same way forever.

**Result.** 568 declared / 322 implemented, 72 of 91 `P0`. `web/uploads` 19/47.

### Phase H — `web/viewer`

**Goal.** Close the loop opened by Phase G: a PDF could be uploaded and not
opened.

**Built.** `viewer.api.ts`, `use-content-url.ts`, `FileViewer`, and the
`/nodes/:id/f/:fileId` route. 17 of 19 declarations.

**The `P0` is `WEB-VIEWER-018`** — a non-PDF must never reach an `<iframe>`.
Implemented as an **early return before every other branch**, so no sequence of
loading states, retries or races can arrive at the frame: the component returns
before that branch exists. Asserted by querying the DOM for the frame's absence
rather than by checking a computed flag, because a component that worked the flag
out correctly and rendered anyway would pass the second kind of test.

The reasoning is worth keeping together in one place, since it spans three
modules: uploads are served from the storage origin, only `application/pdf` is
ever sent `inline`, and the viewer frames that URL. Under
`UPLOAD_FILE_POLICY=all-files` an uploaded `.html` is a real possibility — and
the storage origin is outside the web app's CSP, which is the mitigation the
entire `localStorage` token decision rests on.

#### Blockers

**28. Two links with one accessible name.** *(cost: minutes)* A non-PDF rendered
a download in the header *and* one in the unsupported-type body, so
`getByRole('link', { name: /Download/ })` matched two. Fixed in the UI rather
than the selector — the header link is now only rendered for a previewable file,
and the unsupported state keeps the single prominent action. Second time this
class of bug has appeared (blocker 24 was the same thing with buttons), which
suggests it is worth checking for deliberately rather than discovering by test.

**29. Radix portals dialog content to `document.body`.** *(cost: minutes)* A
container-scoped `querySelector` for the loading state found nothing, and would
have kept finding nothing however the component changed.

**30. An open dialog sets `pointer-events: none` on the body**, so
`userEvent.click(document.body)` is refused outright. The expiry-recovery test
dispatches on `window` instead, which is where the listener is anyway.

#### One spec deviation

The spec routes the viewer at `/rooms/:id/f/:fileId`. The tree is addressed by
**node** id everywhere else in this app, so it is `/nodes/:id/f/:fileId` — same
shape, one addressing scheme rather than two.

**Result.** 569 declared / 339 implemented, 73 of 91 `P0`. `web/viewer` 17/19.

### Phase I — `web/sharing` and `web/public-view`

**Goal.** The half a recipient sees. Until now a link could only be minted with
`curl`, and `/s/:code` was a placeholder — so the screen the whole product exists
to produce did not exist.

**Built.** `ShareDialog` (mint, invite, list, revoke) composed into the
explorer's row menu; `PublicViewPage` at `/s/:code`. 18 of 30 and 14 of 28.

#### What the security declarations forced

Almost every declaration in these two suites is `security`, and they share a
shape: an interaction that could give away more than intended. Three that changed
the implementation rather than merely being asserted:

- **The dialog mints nothing on open.** A dialog that creates a link when it
  opens leaves a live grant behind every time somebody opens it to look — and
  closing it does not undo that. The link is generated on demand.
- **The plaintext lives in component state and the body unmounts on close.** So
  reopening genuinely cannot show it again, which is not a UI choice: only the
  SHA-256 is stored, so no endpoint could return it even if one wanted to. The
  warning is a statement of fact rather than urgency-flavoured copy.
- **An inherited grant gets no revoke button.** It would fail — the grant lives
  on an ancestor — and a control that cannot work is worse than none. The
  ancestor is named instead, so the owner knows where to go.

And on the public side, the one that is easy to get subtly wrong: **a signed-in
visitor still gets the read-only view.** The credential in the URL is what they
arrived with, and honouring it is the difference between previewing what you
shared and looking at your own data while believing you are seeing theirs.

#### Blockers

**31. `<input type="email">` blocked the form's own validation.** *(cost:
minutes, and it would have shipped as "the Invite button does nothing")* Native
constraint validation refuses to submit an invalid value, so `onSubmit` never
ran and the dialog's explanation never rendered. `noValidate` on the form: the
type still buys the right mobile keyboard, and the message is ours — tied to the
field by `aria-describedby`, which the browser's bubble is not.

**32. A test fixture's share id was not a valid UUID.** *(third occurrence)*
`CreatedShareSchema` says `z.uuid()`, so the whole response failed to parse and
six assertions landed on the error state. Same as blocker 22, and the same
lesson: the response parser is doing its job, and fixtures have to be as real as
the contract.

#### Two things deliberately not built

- **The share indicator on explorer rows.** It needs grant data per row, which
  today would be one `/shares` request per row. Doing it properly means the
  listing carrying an `isShared` flag — an API change, not a UI one.
- **`Referrer-Policy: no-referrer` on the `/s/:code` route.** It is a *response*
  header, so it belongs to whatever serves the SPA rather than to React. The API
  already sets it on `/shares/resolve`; the page itself needs a hosting rule.

**Result.** 569 declared / 371 implemented, 77 of 92 `P0`. **Every feature module
in the repository now exists.**

### Phase J — the Playwright journeys

**Goal.** The tier that only means something when the browser, the API **and the
bucket** are all real — including `JOURNEY-001`, which is the whole product in
one pass.

**Built.** A MinIO service in `docker-compose.test.yml`; `S3_ENDPOINT` /
`S3_FORCE_PATH_STYLE` config so the adapter can point at it; an e2e database,
its preparation script, and a Playwright setup project that signs each persona
in once. 16 of 39 journeys, all green in about 50 seconds.

#### The bucket was the blocking problem

`storage` had only ever run against its in-memory twin, so four things had never
executed: the presigned PUT's signature, the `HeadObject` at `/complete`, the
ranged read for the magic bytes, and `Content-Disposition` on download. Three of
those are security-relevant, and none is provable without a bucket.

Adding MinIO took ten lines of compose and two config values, and all four work
first time — verified by hand before any journey was written: a real presigned
PUT, `/complete` taking size and type from the object, **HTML declared as
`application/pdf` rejected with 415 by a ranged read of the real bytes**, and
`inline` disposition on a real PDF.

#### Blockers

**33. Playwright starts `webServer` *before* `globalSetup`.** *(cost: ~15 min)*
So a global setup that creates the database is too late by exactly the amount
that matters — the API had already tried to connect and exited with
`P1003 Database does not exist`. Preparation is a script that `test:e2e` runs
ahead of the runner instead.

**34. A developer's `.env.local` silently won.** *(cost: ~20 min, and it would
have been the worst kind of pass)* The `VITE_API_MODE=mock` left over from
running the app locally beat the `env` passed through Playwright's `webServer`,
because Vite's env files take precedence. The journeys were running against the
**placeholder data layer** — which is precisely what this tier exists not to do,
and the failure only surfaced because the mock's fixture passwords differ from
the seeded ones. Fixed with a committed `apps/web/.env.e2e` and `vite --mode
e2e`: mode files beat `.env.local`, which is the only ordering that is immune to
whatever a developer has lying around.

**35. The dev proxy never rewrote its prefix.** *(a real bug, found on the way)*
`vite.config.ts` proxies `/api` to the API, the client's default base URL *is*
`/api`, and the API serves `/auth/login` — so the default configuration 404s on
every request. It had gone unnoticed because a `.env.local` with
`VITE_API_URL=http://localhost:3000` bypasses the proxy entirely, so the only
person who hits it is one who follows the documented setup and leaves that line
unset. Now rewritten.

**36. A blank env var is not an unset one.** `VITE_API_URL=` yields `''`, and
`?? '/api'` does not catch an empty string — so every request went to the page's
own origin and the login screen reported "that item is not available". The API's
own config already had this rule (`blankAsUndefined`); the client has it now too.

**37. Fourteen UI logins exceeded the login throttle.** *(cost: ~20 min)* Every
journey runs from `127.0.0.1` and login is ten a minute, so the suite ran out
part-way through and the failures landed on whichever tests happened to be later
— reading as "the admin journeys are flaky". Disabling the throttle for tests was
the other option and is the wrong one: it is a real protection on the most
attacked route in the system, and a suite that only passes with it off is not
testing what ships. A setup project signs each persona in **once** and saves
`storageState`.

**38. `page.request` carries no `Authorization` header** — that is the axios
interceptor's job and it only runs inside the app. This is the one worth
remembering: **`JOURNEY-035` passed while proving nothing.** It asserts that a
signed-in non-admin gets 404 from `/jobs`, and was actually observing an
*anonymous* caller get 404. The token is read out of `localStorage` and passed
explicitly now, so the test distinguishes "not an admin" from "not signed in" —
which is the entire point of it.

**Result.** 569 declared / 387 implemented, 80 of 92 `P0`. Every tier in the
testing strategy now has tests in it.

### Phase K — the bucket-dependent storage tests

**Goal.** `API-STORAGE-008..010` had been unimplemented for the entire project
with the standing note "needs a real bucket". Phase J produced one.

**Built.** `suites/api/storage/bucket.int.spec.ts`, running the **real**
`S3StorageAdapter` against MinIO — the one file in the integration suite that
does not use the in-memory twin.

#### The finding: a comment asserted a security property the code did not have

`API-STORAGE-008` failed the first time it ran. `presignPut`'s documentation
said:

> `ContentType` and `ContentLength` are pinned into the signature, so a client
> cannot upload something other than what it declared.

The emitted `X-Amz-SignedHeaders` was **`content-length;host`**. For a presigned
URL the SDK signs only what it must, and `ContentType` on the command sets a
header the signature does not cover — so a browser could declare
`application/pdf` at `/uploads/init` and PUT anything at all. `content-length`
*was* signed, which is why the oversize test passed and the type test did not.

**Nothing downstream was relying on it.** `/complete` takes the size and type
from `HeadObject` and reads the object's leading bytes, and that is the check
that actually decides. So this was missing defence in depth rather than an open
hole. But a comment that asserts a property the code lacks is worse than no
comment — the next person to reason about the upload path would have built on
it. `signableHeaders: new Set(['content-type'])` makes it true, and the journeys
still pass with the stricter signature.

Worth stating plainly: this claim had been in the repository since `storage` was
written, was repeated in `files/TODO.md` and in the web client, and was read many
times. It survived because **nothing could check it** — the in-memory adapter
cannot model a signature at all, and a fake that honours whatever is sent to it
would pass every test in this group while proving the opposite of what they
assert. The bucket is what turned a plausible sentence into a falsifiable one.

**Result.** 570 declared / 391 implemented, 80 of 92 `P0`. `api/storage` 14/14.
