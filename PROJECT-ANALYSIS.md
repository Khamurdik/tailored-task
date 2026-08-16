# Project analysis — Data Room

An independent read of this repository: what it is, how it is put together, what
its design actually commits to, and where the specification is incomplete or
contradicts itself.

*Scope of the analysis: all 22 markdown files, 1,249 lines. There is no source
code, no build tooling, and no version control in the tree.*

---

## 1. What this is

A **virtual data room** — the due-diligence kind: an owner uploads documents
into a folder tree and grants outsiders scoped, revocable, read-only access to
part of it.

What exists today is not the product. It is a **design skeleton**: a directory
layout in which every leaf is a `TODO.md` acting as a module contract. Each one
declares purpose, owned state, public surface, allowed and forbidden
dependencies, a responsibility checklist, invariants, tests, and an acceptance
bar. No `package.json`, no `tsconfig`, no Prisma schema, no CI, no `.git`.

The intended target stack is legible from the specs even though it is never
declared in one place:

| Layer | Choice | Where it is implied |
| --- | --- | --- |
| API | NestJS (guards, pipes, filters, `@nestjs/schedule`, `@nestjs/throttler`) | [common](apps/api/src/common/TODO.md), [auth](apps/api/src/auth/TODO.md), [jobs](apps/api/src/jobs/TODO.md) |
| DB | Postgres via Prisma, `citext` + `pg_trgm` | [common](apps/api/src/common/TODO.md), [users](apps/api/src/users/TODO.md), [search](apps/api/src/search/TODO.md) |
| Blobs | S3, presigned direct-to-browser | [storage](apps/api/src/storage/TODO.md) |
| Web | React + react-query + zustand + shadcn + react-hook-form | [web/shared](apps/web/src/shared/TODO.md), [uploads](apps/web/src/features/uploads/TODO.md) |
| Contract | zod in a shared workspace package | [packages/shared](packages/shared/TODO.md) |
| Deploy | Vercel (web) + AWS App Runner (api) + Neon (db) | [auth](apps/api/src/auth/TODO.md), [common](apps/api/src/common/TODO.md), [jobs](apps/api/src/jobs/TODO.md) |

The prose repeatedly addresses "the brief", "the README deliverable", and
"reviewers", and marks two modules as *extra credit*. This is a **take-home
engineering assignment**, and the skeleton is deliberately doubling as the
design-record deliverable.

---

## 2. The one idea the whole system rests on

Rooms, folders, and files are **one `nodes` table** discriminated by `type`,
linked by `parent_id`, carrying a materialized `path` of ancestor ids.

Almost every non-obvious decision downstream is a consequence of that choice:

- **Ancestor grants resolve with no recursion.** `access` parses ancestor ids
  out of `path` and fetches every relevant grant in a single query. That is what
  lets the permission resolver be a *pure function*.
- **Cascade operations are prefix operations.** Soft-delete, subtree stats,
  audit scoping, and search scoping are all `path LIKE $prefix || '%'`.
- **Move is one `UPDATE`.** `replace(path, $old, $new)` over the prefix, plus a
  depth delta.
- **The cost is invariant maintenance.** `path` is derived state, so six of the
  eight system-wide invariants exist purely to keep it honest — and
  `rebuildSubtree` exists as the escape hatch when it isn't.

The design knows this and prices it correctly: `parent_id` is declared the
source of truth, `path` a rebuildable index.

---

## 3. Structure

### Backend — five layers, 11 modules

```
L4   jobs          audit                 reactive / scheduled
L3   sharing       files      search     use-cases, controllers
L2   auth          access                identity  /  authorization
L1   users         nodes      storage    domain primitives, adapters
L0   common                              infrastructure, zero domain
```

I checked every module's declared dependencies against this graph. **They are
consistent** — no module imports upward, and no same-layer import is declared.
That is not a given in a spec written module-by-module, and it is the strongest
signal that the layering was derived rather than decorated.

### Frontend — one shared core, six features

`shared/` (client, error mapping, query keys, primitives) plus `auth`,
`explorer`, `uploads`, `viewer`, `sharing`, `public-view`. Features are supposed
to compose at the route level rather than import each other.

---

## 4. The three decisions worth pointing at

These are the parts a reviewer would actually probe, and each is already argued
for in the text.

**Splitting `access` from `sharing`.** A share controller needs the "only an
owner may share" guard; the guard needs to read shares. Same module ⇒
`sharing → access → sharing`. Pushing the `shares` table and the resolver down
to L2 breaks the cycle, and the payoff is that the resolver becomes a pure
function — so the **full permission matrix is a millisecond unit test, not an
e2e suite**. The cycle argument justifies the split; the testability argument is
why it is a good split.

**One inverted dependency, declared and bounded.** `access` needs node paths;
`nodes` controllers need the access guard. `access` declares a `NODE_LOOKUP`
port with a five-field `NodeSnapshot` and never imports `nodes`;
`NodesRepository` satisfies it; the binding happens once in `AppModule`. The
stated rule — *no `forwardRef` anywhere; if you reach for one, a boundary is
wrong* — is the useful part. It converts a style preference into a falsifiable
check.

**Denial is 404, never 403.** A 403 confirms an id exists, which is an
enumeration oracle across every room in the system. Paired with a `SessionGuard`
that returns `null` instead of 401 — because anonymous share visitors are
legitimate callers, and routes opt into requiring a user via `@RequireAuth()` —
this gives the owner path and the public-share path a *single* permission code
path. That is the central security property of the design, and the sharing
scoping test (grant on folder B, request sibling C with B's token → 404) is
aimed exactly at it.

---

## 5. Where the specification is genuinely strong

**It names failure modes instead of happy paths.** Upload is specified as four
states, not one, with an owner for each: node-without-object (hourly reaper),
object-without-node (S3 lifecycle rule), active-node-without-object
(`HeadObject` at complete), deleted-node-with-object (correct, keep it).

**It writes down limitations rather than hiding them.** A presigned GET cannot
be revoked once issued; the 60-second TTL is the whole mitigation, and the spec
says to put that in the README instead of pretending otherwise. Same for
single-instance jobs, unbounded audit growth, and move-into-a-shared-folder
semantics.

**The operational details are specific and hard-won.** `/health` must do no I/O
because App Runner polls every ~10s and a DB query there stops Neon scaling to
zero. Depth is capped at 32 because a btree entry maxes near 2,704 bytes and a
UUID path segment is 37 chars, so an uncapped tree dies at ~73 levels with a raw
Postgres error. The cross-domain refresh-cookie trap gets a preferred fix (a
Vercel rewrite making cookies first-party) *and* the fallback. None of these are
things you write before having hit them.

**Unicode is treated as a first-class correctness concern**, not an
afterthought: NFC normalization before uniqueness checks, `citext` for email,
bidi-override stripping in `sanitizeName`, and — the subtle one — a keyset
cursor whose collation must match the `ORDER BY` collation exactly, because a
mismatch silently skips or duplicates rows at page boundaries and *only* shows
up with non-ASCII names.

**The test strategy is leveraged rather than exhaustive.** Three tests carry
most of the risk: a 200-operation property test over the tree (explicitly to be
written *before* folder CRUD exists), the pure permission matrix, and one
Playwright run — upload → share → second cookieless browser context → revoke →
404 — that the spec correctly calls a demonstration of the whole product.

**Optimism is applied selectively and justified.** Create and rename are
optimistic because rollback is trivial; move and delete are not, because they
touch several cache entries plus ancestor stats and a correct rollback costs
more than the feature is worth. Meanwhile every mutation invalidates the
`['nodes']` prefix wholesale — over-invalidating is cheap and always correct.
Deliberate inconsistency, with the reasoning attached.

---

## 6. Gaps, contradictions, and risks

Found by cross-reading the specs against each other. Ordered by how much they
would cost to discover during implementation instead of now.

### 6.1 Contradictions

| # | Issue | Where |
| --- | --- | --- |
| 1 | **Who listens to `node.deleted`?** `nodes` says the event is emitted "so `access` can revoke grants". `sharing` says it owns the listener (`SharingService.revokeSubtree`), and the README agrees. Two modules are specified as the subscriber; only one can be. | [nodes:40](apps/api/src/nodes/TODO.md#L40) vs [sharing:30](apps/api/src/sharing/TODO.md#L30) |
| 2 | **`common` cannot depend on nothing.** Its stated dependencies are "Nothing" and "Must not depend on: Anything", yet it must import `zod` (config schema) and the `ErrorCode` union from `packages/shared`. The intent is clearly *no domain modules*; as written it is false. | [common:20-24](apps/api/src/common/TODO.md#L20-L24) |
| 3 | **`audit` needs `access`.** It exposes `GET /nodes/:id/activity`, "owner only" — which requires the access guard — while declaring `common` as its only dependency and "nothing imports it" as an invariant. A guarded controller breaks the pure-listener framing. | [audit:13-21](apps/api/src/audit/TODO.md#L13-L21) |
| 4 | **Feature folders and `public-view`.** The architecture says feature folders never import each other and compose at the route level; `public-view` lists `explorer` and `viewer` as dependencies. Defensible, since `public-view` *is* a route — but the rule and the dependency list contradict each other textually. | [ARCHITECTURE:128](docs/ARCHITECTURE.md#L128) vs [public-view:13](apps/web/src/features/public-view/TODO.md#L13) |
| 5 | **`ARCHITECTURE.md` is duplicated verbatim** at the repo root and in `docs/`. Byte-identical today; guaranteed to diverge. Every cross-reference points at the `docs/` copy, so the root copy is the one to delete. | root vs `docs/` |

### 6.2 Missing specification

- **The `nodes` schema does not exist.** `nodes` says "Schema per
  `docs/ARCHITECTURE.md`, plus all five indexes" — and the architecture document
  contains no DDL and no index list. The single most important table in the
  system, and its shape and every index are unspecified. This is the largest
  hole in the tree.
- **No event bus owner.** Five events are specified (`user.registered`,
  `node.created`, `node.moved`, `node.deleted`, `share.created`, `share.revoked`,
  `file.viewed`) and the entire decoupling story depends on them, but no module
  provides the emitter and no file defines the payloads. `common` is the natural
  home; its public surface doesn't mention it.
- **`file.viewed` has no emitter.** `audit` subscribes to it; `files` — which
  owns `/nodes/:id/content-url`, the only place a view can be observed — lists no
  events at all.
- **Versioning is half-present.** The storage key scheme is
  `rooms/{rootId}/{nodeId}/{versionId}` and `files` states "never delete an
  object referenced by any file version", but no module owns a versions table and
  no responsibility mentions creating one. Either a latent feature or a key
  scheme that should be simplified until it exists.
- **`Role` is never defined.** `access` owns "the definition of `Role`", mentions
  `none`, `editor`, and `max(role)`, and `@RequireAccess` takes
  `'read' | 'write' | 'own'`. The role union itself, and the mapping from roles
  to those three verbs, appear nowhere.
- **Constants are mostly unvalued.** `MAX_DEPTH` (32) and the GET TTL (60s) are
  pinned; `MAX_FILE_SIZE`, `MAX_NAME_LENGTH` (255 is implied by `sanitizeName`),
  and `PAGE_SIZE` are named but never given numbers.
- **PDF-only is left conditional.** "Verify magic bytes `%PDF-` **if** enforcing
  PDF-only" — while the viewer is PDF-specific. The decision is deferred in a
  place where it changes validation, the viewer, and the error taxonomy.
- **No workspace tooling.** `apps/*` + `packages/shared` implies a pnpm/turbo
  monorepo; nothing configures one. Path aliases, the shared package's build, and
  the layering rules themselves (which are exactly what an ESLint boundaries rule
  or `dependency-cruiser` config could *enforce* rather than merely document) are
  all unaddressed.

### 6.3 Risks in the design itself

- **Search + permissions + keyset pagination is the hard one.** `search` requires
  filtering unreadable nodes *before* paginating, but `access` is built around
  resolving one node at a time behind a guard. Doing this per-row over a result
  page is N queries; doing it in SQL means the grant-resolution logic exists in a
  second place, which is precisely what the pure-resolver design was meant to
  prevent. `search` is marked optional — this is a good reason to keep it that
  way, or to restrict it to subtrees the actor can already read wholesale.
- **Trigger-maintained rollups under prefix updates.** `subtree_files` /
  `subtree_bytes` are trigger-maintained, while cascade delete and move are
  single bulk `UPDATE`s over a path prefix. Bulk statements are exactly where
  row-trigger rollups get expensive or subtly wrong. The daily reconciliation job
  is the right instinct — but it detects drift, it does not prevent it.
- **`sharing` depends on `nodes` "read only, to display names".** A read-only
  dependency is still a dependency; nothing in the spec enforces the "read only"
  half. Worth a narrow port, in the style already established by `NODE_LOOKUP`.
- **The share-token query-key namespacing rule is load-bearing and easy to
  violate.** `public-view` correctly identifies shared cache entries between owner
  and share views as *the* mechanism by which private data leaks into a public
  page. It is a convention with no structural enforcement — the highest-value
  place to add a lint rule or a key-factory that makes the wrong thing
  unexpressible.

---

## 7. Assessment

**As a design document, this is well above the bar for its format.** The
layering is internally consistent, the two genuinely hard boundary problems
(authn/authz, and the `nodes ↔ access` cycle) are identified and solved rather
than deferred, and the operational notes carry the specificity of lessons
already learned. The choice to write acceptance criteria and the highest-value
tests *before* any code is the reason the contradictions in §6.1 are findable at
all — they are visible precisely because each module was made to state its
dependencies explicitly.

**Its weakness is the reverse of its strength.** Written module-by-module, it is
very good on module interiors and thin at the seams: the schema of the central
table is missing, the event bus that carries the decoupling story has no owner,
and three cross-module contradictions survive because no single document
reconciles the parts. The layering rules are stated as prose discipline in a
place where they could be mechanically enforced.

**If I were starting implementation**, the order would be: write the `nodes`
DDL + indexes into `docs/ARCHITECTURE.md` and delete the duplicate at the root;
resolve the four contradictions in §6.1 with one line each; give the event bus an
owner and a payload contract in `common`; pin the remaining constants and the
PDF-only decision; stand up the workspace with a boundaries lint rule encoding
the L0–L4 graph. That is perhaps a day's work, and it removes every decision
that would otherwise be made ad hoc, mid-implementation, by whoever hits it
first.

Then follow the suggested order as written — `common → storage → users → nodes`
— and write the tree property test before folder CRUD exists, exactly as
[nodes](apps/api/src/nodes/TODO.md#L57) instructs.
