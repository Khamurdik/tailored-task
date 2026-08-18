# Handoff — the implementation sessions

A record of the sessions that took this repository from a booting API with one
login screen to a working product, written so the next person can pick it up
without re-deriving anything.

[`HANDOFF.md`](HANDOFF.md) is the **design** record and is still accurate — read
it for *why* the system is shaped the way it is. This file is its sibling for the
build: what got made, what turned out to be wrong, and what is deliberately still
missing.

*Written 2026-08-17. Phases A and B are committed (`4543e87`); everything after
that is in the working tree, unstaged, as the working agreements require.*

---

## 1. Read in this order

0. **this file** — what happened during implementation
1. [`IMPLEMENTATION-STATUS.md`](IMPLEMENTATION-STATUS.md) — where the code is now
2. [`IMPLEMENTATION-LOG.md`](IMPLEMENTATION-LOG.md) — chronological, one entry per
   phase, **38 numbered blockers with what unblocked them**
3. [`HANDOFF.md`](HANDOFF.md) — the design decisions this build is standing on
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the only whole-system document
5. [`DEPLOYMENT.md`](DEPLOYMENT.md) — how to run it locally; §8 is what is still not true
6. [`DEPLOYMENT-CLOUD.md`](DEPLOYMENT-CLOUD.md) — AWS and Vercel; §9 is what is not provisioned

---

## 2. Where it ended up

**570 declared tests · 394 implemented · 81 of 92 `P0`.** Lint, typecheck and
build clean in all four packages. 37 Vitest files green, plus 20 Playwright
journeys in about 50 seconds.

| | Start | End |
| --- | --- | --- |
| Declared / implemented | 556 / 156 | **570 / 394** |
| `P0` | 36 / 83 | **81 / 92** |
| API modules built | 6 of 12 | **12 of 12** |
| Web features built | 2 of 7 | **7 of 7** |
| Migrations | 4 | 5 |

**Every module in the layer graph now exists**, and the product works end to end
in a browser: sign in, create a room and folders, upload PDFs direct to a bucket
with real progress, preview them, share a folder, and open that link as a
stranger who sees a read-only view that dies the instant it is revoked.

```
suites/api/files          22/  22    suites/api/sharing        20/  20
suites/api/jobs           24/  24    suites/api/storage        14/  14
suites/api/users          15/  15    suites/api/links          22/  23
suites/contract           12/  12    suites/web/shared         44/  44
suites/web/viewer         17/  19    suites/web/explorer       32/  81
suites/web/uploads        19/  47    suites/web/sharing        18/  30
suites/web/public-view    14/  28    suites/journeys           16/  39
suites/api/access         18/  20    suites/api/auth           18/  28
suites/api/common         12/  18    suites/api/nodes          22/  28
suites/web/auth           35/  49    suites/api/search          0/   9  (deferred)
```

---

## 3. What was built

| Phase | Module | Note |
| --- | --- | --- |
| A | **`tree`** (new, L3) | The tree's HTTP surface. Keyset listing, breadcrumbs, 9 routes |
| B | `sharing`, `links` | Issue/list/revoke; the anonymous resolve edge |
| C | `files` | Upload lifecycle, magic-byte policy, rollups, reaper |
| D | — | `api/users` coverage (the module was already built) |
| E | `jobs` | Registry, `job_runs`, 5 routes, 6 jobs, sweep + stale guard |
| F | `web/explorer` | Browse, create, rename, delete, `readOnly` |
| G | `web/uploads` | Dropzone, queue, progress, cancel, retry |
| H | `web/viewer` | PDF preview, download, expiry recovery |
| I | `web/sharing`, `web/public-view` | Mint a link; the `/s/:code` page |
| J | Playwright journeys | Real browser + API + Postgres + **bucket** |
| K | `api/storage` 008–010 | The three that had never run |

---

## 4. Decisions a new session should not relitigate

Five of these were escalated and answered by the user; the rest were taken with
the reasoning written into the module `TODO.md` beside the code.

### 4.1 `tree` is a new L3 module *(user's call)*

The tree's controller had nowhere to live. `nodes` is L1 and its spec says "Must
not depend on: `access`"; a controller needs `@RequireAccess`, which is L2. Both
alternatives broke something stated — putting the controller in `nodes` inverts
the layer graph, and carving out an exception for controllers retires the claim
this repository repeats most often.

`tree` is that rule applied to the tree itself: every node-scoped route already
belonged to the L3 module that owns what it returns (`sharing` owns
`/nodes/:id/shares`, `files` owns `/nodes/:id/content-url`). The pattern existed
and was simply unnamed.

### 4.2 Two routes a guard structurally cannot protect *(user's call)*

`POST /nodes/folders` names its parent in the request **body**, and
`PATCH /nodes/:id/parent` names its destination there. `NodeAccessGuard` reads
route parameters, so **folder creation was open to any authenticated caller in
anybody's room**, and a move could land a node in a room the caller has no access
to.

The user chose the controller-side check. To stop that becoming a second,
divergent implementation of the most security-critical decision in the system,
`NodeAccessResolver` was extracted from the guard: the guard is now a thin
adapter over it, and the controller calls the same method. One implementation,
two callers, one `throw` site — which is what keeps `API-ACCESS-011`'s
byte-identical 404 true.

### 4.3 `tree` before `sharing` — an ordering the docs had wrong

`IMPLEMENTATION-STATUS.md` §8 said `sharing` + `links` first. They cannot give
the guard a *readable* route: every route in `sharing` is
`@RequireAccess('own')`, which a share token can never satisfy. `API-SHARING-002`
— "a token for folder B requesting sibling C returns 404", the test a reviewer
tries by hand — had nothing to point at until `GET /nodes/:id` existed.

### 4.4 Spec deviations, each written into its module `TODO.md`

| Spec said | What was done | Why |
| --- | --- | --- |
| Rollups "maintained by trigger" | Application code, inside the transaction that flips the row | A trigger puts half the invariant in the schema; `reconcile-rollups` is the backstop either way |
| `/jobs` guarded by `@RequireAuth()` **plus** an admin check | `AdminGuard` alone | `@RequireAuth()` throws **401**, which confirms an admin surface exists — and the next line of the same spec asks for 404 |
| Viewer at `/rooms/:id/f/:fileId` | `/nodes/:id/f/:fileId` | The tree is addressed by node id everywhere else; two addressing schemes is one too many |
| `CreatedShareSchema.token: z.string()` | `.nullable()` | The database forbids a token on a `user` grant (`shares_kind_shape`); the mock returned `''` to bridge it, and an empty string is not a token |
| Throttle manual job triggers **per user** | Per IP | `@nestjs/throttler` tracks by address; a per-user key needs a custom tracker. Small difference here, but not what was asked |

---

## 5. What running things found

Thirty-eight blockers are logged in
[`IMPLEMENTATION-LOG.md`](IMPLEMENTATION-LOG.md). The pattern worth carrying
forward is that **almost every real defect lived in code that had never
executed**, and several lived in *comments* that asserted properties nothing
could check.

The five most worth knowing:

1. **Every cursor the system produced was invalid under its own contract.**
   `encodeCursor` emitted `base64url(payload).base64url(hmac)`; `CursorSchema` is
   `z.base64url()`, and `.` is not in that alphabet. `API-COMMON-010`
   round-trips the encoder against the decoder — and two functions that agree
   with each other can both disagree with the schema. Nothing had ever produced a
   cursor before the listing existed.

2. **`presignPut`'s doc comment asserted a security property the code lacked.**
   It claimed `ContentType` was pinned into the signature. The emitted
   `X-Amz-SignedHeaders` was `content-length;host` — so a browser could declare
   `application/pdf` and PUT anything. Nothing downstream relied on it
   (`/complete` reads the bytes), so this was missing defence-in-depth rather
   than an open hole. It survived because **nothing could check it**: the
   in-memory adapter cannot model a signature, and a fake that honours whatever
   it is sent would pass the whole group while proving the opposite.

3. **Breadcrumbs named every folder above a share.** The guard resolved a
   visitor's *role* perfectly and had nothing to say about response content, so
   the trail was built from the room root. Nothing in the permission model was
   wrong; the leak was in presentation, which is why no existing test was going
   to find it.

4. **`readOnly` missed the empty state.** It was applied to row actions and the
   header, and the empty state renders from a **different branch** — so every
   empty folder in a share view still offered a create button.

5. **`JOURNEY-035` passed while proving nothing.** It asserts a signed-in
   *non-admin* gets 404 from `/jobs`. `page.request` carries no `Authorization`
   header — that is the axios interceptor's job and it only runs inside the app —
   so it was actually watching an *anonymous* caller get 404.

Two of these (1, 2) are the argument for the testing tiers existing, made
concrete: a claim only becomes falsifiable when something real can refuse it.

---

## 6. Infrastructure added

- **MinIO in `docker-compose.test.yml`**, plus `S3_ENDPOINT` /
  `S3_FORCE_PATH_STYLE`. `storage` had only ever run against its in-memory twin,
  so four things had never executed: the presigned PUT's signature, the
  `HeadObject`, the ranged read for magic bytes, and `Content-Disposition`. Three
  are security-relevant. **Uploads now work locally with no AWS account.**
- **A Playwright harness**: its own `dataroom_e2e` database, a preparation script
  that runs *before* the runner (Playwright starts `webServer` before
  `globalSetup`, so a global setup is too late), and a setup project that signs
  each persona in once — because 14 UI logins exceeded the login throttle, and
  disabling a real protection to make tests pass is the wrong trade.
- **`apps/api/src/app.setup.ts`**, so `main.ts` and the integration harness apply
  one composition. A second copy that forgets `ErrorFilter` turns every
  `AppError` into a 500 and every "denial is 404" assertion fails for the wrong
  reason.
- **`apps/web/.env.e2e`** and `vite --mode e2e`. A developer's `.env.local` with
  `VITE_API_MODE=mock` silently beat the environment passed to Playwright, so the
  journeys were running against the placeholder data layer — exactly what that
  tier exists not to do.

Two product bugs fell out of the harness work: the **dev proxy never rewrote its
`/api` prefix** (so the documented default configuration 404s on every request,
masked for anyone whose `.env.local` sets `VITE_API_URL`), and **a blank env var
is not an unset one** (`VITE_API_URL=` yields `''`, and `?? '/api'` does not
catch it).

---

## 7. What is deliberately not done

Stated plainly, because a list of what is missing is more useful than a claim of
completeness. Each is unticked with a reason in its module `TODO.md`.

**Features**

- `web/explorer` (32/81): no drag-to-move, no bulk selection, no keyboard
  navigation, and **create/rename are not optimistic** though the spec asks for
  it. They close on success and invalidate — correct, and a visible flash on a
  slow connection. Deferred rather than half-built: an optimistic update whose
  rollback is untested is worse than none, because its failure mode is a row that
  exists only on the client.
- `web/uploads` (19/47): no per-row drop target, no directory expansion, no
  cross-tab `BroadcastChannel` mirror (the spec marks that optional).
- `web/sharing` (18/30): no expiry picker, and **no share indicator on explorer
  rows** — that needs grant data per row, which today is one `/shares` request
  per row. Doing it properly means the listing carrying an `isShared` flag, which
  is an API change.
- ~~`public-view`: `Referrer-Policy: no-referrer` on the `/s/:code` **page** is
  not set.~~ **Now set, in `vercel.json`** — it is a response header, so it
  belongs to whatever serves the SPA, and that is now a file in the repo rather
  than an unwritten platform setting. Untested until something is actually
  deployed; the `<meta name="referrer">` in `index.html` is what covers the
  document in the meantime.
- `search` and `audit` remain deferred and out of scope, as designed.

**Operational**

- **Nothing is deployed.** The build artifacts now exist and are exercised
  locally — `apps/api/Dockerfile` and `vercel.json`, see `DEPLOYMENT-CLOUD.md` —
  but nothing is provisioned. `jobs/TODO.md` §5 asks for the API pinned to a single
  instance (`minSize: 1`/`maxSize: 1`) — that is the thing the startup sweep's
  correctness actually rests on, and it is the one requirement there that lives
  in infrastructure rather than code. Left unticked rather than quietly counted.
- **MinIO is not AWS.** It implements the same API and is not the same service;
  the adapter has still never talked to S3 proper.

**Known defects in the test suite itself**

- ~~**`tests/suites/api/nodes/tree.int.spec.ts` has mis-mapped ids.**~~
  **Fixed 2026-08-18.** Its tests `002`–`008` asserted behaviours belonging to
  other declarations (`002` is declared as a depth property and tested
  cyclic-move rejection, and so on down). Retitled to the declarations they
  actually assert — `005`, `006`, `007`, `009`, `011`, `019`, `020` — and the
  property test now names all four of `001`–`004`, which is what it has always
  asserted (`assertTreeIsConsistent` checks exactly those four, and `TODO.md`
  §Notes specifies them as one model). The gate reads every id in a title, so
  the trace is one-to-one again.

  Worth noting what this moved: `api/nodes` went 19/28 → **22/28** and the `P0`
  count 80 → **81**, without a line of test logic changing. Three declarations
  were being credited to tests that did not assert them while the tests that did
  assert them counted for nothing. That is the failure mode a registry keyed on
  ids rather than descriptions has, and it stays invisible until someone reads
  both columns side by side.
- **The coverage gate reads any `WORD-123` in a test title as an id.** "…a
  SHA-256 of the token…" registered as an implementation of a declaration called
  `SHA-256`. It reports it loudly rather than miscounting, which is the right way
  round.

---

## 8. Running it

```bash
nvm use 26.7.0
pnpm install
pnpm --filter @dataroom/shared build          # not optional, not automatic
docker compose -f docker-compose.test.yml up -d   # Postgres :5433, MinIO :9000
```

| Want | Command |
| --- | --- |
| The whole product, real stack | `pnpm db:migrate && pnpm db:seed && pnpm dev` |
| The web app with **no backend** | `VITE_API_MODE=mock` in `.env.local`, then `pnpm dev:web` |
| Unit + integration | `pnpm test` (needs Docker) |
| The journeys | `pnpm --filter @dataroom/tests test:e2e` |
| Real progress number | `pnpm declared` |

**Uploads need a bucket.** Point the API at the local one — see
[`DEPLOYMENT.md`](DEPLOYMENT.md) §3 "Uploading locally". Without `S3_ENDPOINT`
the adapter talks to real AWS, which is the deployed configuration.

**A red `pnpm test` is the resting state.** The failures are the coverage gate
emitting one per unimplemented declaration; every real test file is green.

---

## 9. Where to start

In rough order of value:

1. **Finish `web/explorer`** — 49 declarations, and the largest coherent chunk of
   product left. Drag-to-move, bulk selection, keyboard navigation, optimistic
   create/rename.
2. **The remaining 23 journeys** — mostly resilience, which needs the API stubbed
   at the network layer rather than actually killed, or they become the flakiest
   tests in the repo (`journeys/TODO.md` says so, and it is right).
3. **The ~30 unwritten declarations against finished API modules** —
   `api/nodes` 22/28, `api/auth` 18/28, `api/common` 12/18, `api/access` 18/20.
   Cheap, and where most of the 12 remaining `P0`s live.
4. **The `tree.int.spec.ts` id mapping**, before the suite grows further around
   it.

---

## 10. Working agreements observed

- **The user stages and commits.** No `git add`, no `git commit` — the tree is
  left dirty and reported. 101 paths are currently unstaged.
- Specs come before code. Every module `TODO.md` has ticked boxes and an
  **Implementation notes** section recording what did not survive contact.
- **When a spec turns out to be wrong, change the spec and say why** rather than
  quietly diverging. §4.4 lists the five that happened here.
- Do not run `ncu -u`. Four version holds are deliberate — see
  [`docs/TOOLCHAIN.md`](docs/TOOLCHAIN.md).
- Node via nvm, 26.7.0. Corepack does not work; global pnpm is per-Node-version.
