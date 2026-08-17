# tree — L3

## Purpose
The HTTP surface of the tree. Turns `/nodes/*` requests into `NodesService`
calls, and node rows into the wire shapes `packages/shared` declares.

## Owns
Nothing. No table, no domain rule, no randomness. It owns the **route table for
the tree** and the mapping between a `Node` and a `NodeSummary` / `NodeDetail`.

## Public surface
- `NodesController` — `/nodes` and everything under it that is not owned by
  another L3 module

Nothing imports this module. It is a leaf, like every controller-only module
should be.

## Depends on
`common`, `nodes`, `access` (guard and resolver), `auth` (`SessionGuard`,
`@RequireAuth`, `@Actor`).

## Must not depend on
`sharing`, `links`, `files`, `jobs`. Those are peers in L3 and each owns its own
`/nodes/:id/*` routes — `sharing` owns `/nodes/:id/shares`, `files` owns
`/nodes/:id/content-url`. A route belongs to whichever module owns the thing it
returns, not to whichever module happens to own the URL prefix.

## Why this module exists at all

Because `nodes` is L1 and a controller needs `@RequireAccess`, which is L2.

The tree's routes had nowhere to live. `nodes/TODO.md` says plainly that the
module must not depend on `access` — *"authorization is decided before this
module is called"* — and putting a controller inside it would make L1 import L2,
inverting the one claim this repository repeats most often. The two alternatives
were both worse than a new module:

- **Relax the rule for controllers.** The layer graph is the most-repeated claim
  in the repo and (per `IMPLEMENTATION-STATUS.md` §8) the only one nothing
  checks. Carving out an exception for the first module that finds it
  inconvenient is how it stops being true.
- **Fold the routes into `files`.** That module is specified as `nodes` +
  `storage`; tree CRUD is neither, and its Purpose section stops being one
  sentence without an "and" — the README's own test for a module doing two
  things.

The pattern this follows already existed and was simply not named: every other
node-scoped route in the system lives in the L3 module that owns what it
returns. This module is that rule applied to the tree itself.

## Route table

Mirrors the placeholder data layer's router (`apps/web/src/shared/mock/router.ts`)
so the web app changes one environment variable to move between them. Where the
two disagree, the mock is wrong and follows.

| Method | Route | Guard | Notes |
| --- | --- | --- | --- |
| `GET` | `/nodes` | `@RequireAuth()` | The caller's rooms. Not node-scoped — a room has no parent to authorize against |
| `POST` | `/nodes` | `@RequireAuth()` | Create a room |
| `POST` | `/nodes/folders` | **controller check** | `parentId` is in the body; see below |
| `GET` | `/nodes/:id` | `@RequireAccess('read')` | |
| `GET` | `/nodes/:id/children` | `@RequireAccess('read')` | Keyset paginated, breadcrumbs inline |
| `GET` | `/nodes/:id/stats` | `@RequireAccess('read')` | Live aggregate, for delete confirmation |
| `PATCH` | `/nodes/:id/name` | `@RequireAccess('write')` | |
| `PATCH` | `/nodes/:id/parent` | `@RequireAccess('write')` + **controller check** | Destination is in the body; see below |
| `DELETE` | `/nodes/:id` | `@RequireAccess('write')` | Cascade soft-delete |

Declaration order matters: `GET /nodes` must be declared before `GET /nodes/:id`
or the literal is swallowed by the parameter. The mock's router carries the same
warning for the same reason.

## The two routes a guard cannot protect

`NodeAccessGuard` reads the route's parameters. Two operations name a node in
the **body** instead, and both were unguarded as originally specified:

- **`POST /nodes/folders`** names its parent in the body. The route has no `:id`,
  so the guard never fires and folder creation was open to any authenticated
  caller.
- **`PATCH /nodes/:id/parent`** names its destination in the body. The guard
  authorizes the node being *moved* and says nothing about where it lands — so a
  node could be moved into a folder the caller cannot write.

Both are closed by calling `NodeAccessResolver` directly, which is the **same
method the guard calls**. That was the condition for accepting a controller-side
check at all: a hand-written second implementation of the authorization decision
is where the subtle divergence lives — one that forgets `ancestorsDeleted`, or
resolves a share credential to any live grant rather than the one the caller
named. There is one implementation and two callers.

- [x] `assertWritable(actor, nodeId)` — one private helper, used by both routes,
      throwing the same `AppError.notFound()` the guard throws so denial stays
      byte-identical (`API-ACCESS-011`)

## Responsibilities
- [x] The route table above
- [x] `SessionGuard` before `NodeAccessGuard`, in that order — the second reads
      `req.actor`, which the first sets
- [x] Map `Node` → `NodeSummary` / `NodeDetail`, parsing every response through
      its `packages/shared` schema before it leaves
- [x] Breadcrumbs stop at `access.grantNodeId` for a share visitor
- [ ] `subtreeFiles` / `subtreeBytes` are served from the stored rollups, which
      nothing maintains yet. Correct while no files exist; `files` lands the
      maintenance with `API-FILES-016`

## Invariants
- **Nothing here decides authorization.** Every check is a guard or a call to
  `NodeAccessResolver`. A comparison against `ownerId` written in this module
  would be a second permission code path, which is the thing `access` exists to
  prevent.
- Every response body is parsed through its shared schema on the way out. A
  response that does not match the contract is a 500 here rather than a shape
  the client learns to tolerate.
- A share visitor's breadcrumbs never name a node above the grant.

## Tests

> These are the **requirements**. They are declared as addressable, traceable tests in
> [`tests/suites/api/nodes/TODO.md`](../../../../tests/suites/api/nodes/TODO.md) and
> [`tests/suites/api/access/TODO.md`](../../../../tests/suites/api/access/TODO.md), and implemented there — never in this module's folder.

This module has no suite of its own on purpose. What it does is expose `nodes`
over HTTP and apply `access`'s guard, so its tests are the listing declarations
in `api/nodes` and the scoping declarations in `api/sharing` — both of which
needed an HTTP route before they could be written at all.

- [ ] Listing order, pagination, cursor collation, breadcrumbs
      (`API-NODES-015..018`)
- [ ] A share token for folder B cannot read sibling C or B's parent
      (`API-SHARING-002`, `API-SHARING-003`)
- [ ] Folder creation under a parent the caller cannot write is a 404
- [ ] A move into a destination the caller cannot write is a 404

## Done when
A 5-level tree can be created, listed, paged, renamed, moved and cascade-deleted
over HTTP, and every one of those routes returns 404 to a caller holding a share
token for a different subtree.
