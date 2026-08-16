# Architecture

## The shape of the system

A Data Room is a tree. Rooms, folders, and files are rows in one
**self-referencing `nodes` table**, discriminated by `type` and linked by
`parent_id`. `parent_id` is the source of truth for ancestry; everything else
about the tree is derived from it.

*How* ancestry is queried — a materialized `path` column, a recursive CTE, a
closure table — is a decision **inside `nodes`**, and it is deliberately still
open. See [`nodes/TODO.md`](../apps/api/src/nodes/TODO.md) §Storage. No module
outside `nodes` names a column, and nothing above L1 is allowed to assume a
strategy was chosen. What the rest of the system compiles against is the
**ancestor chain as an ordered list of ids**, which every candidate strategy can
produce.

The materialized path is the strategy the module currently expects to pick, so
the notes that price it — prefix `LIKE` under `text_pattern_ops`, fixed-width
UUID segments, the depth cap — are kept below rather than discarded. They are
consequences of a choice, not premises of the design.

Everything else in the backend is one of three things: something that owns a
piece of that tree's lifecycle, something that evaluates who may touch it, or
plumbing.

## Layers

A module may import from any layer strictly below it, never from its own layer
except where noted, and never from above.

```
L4   jobs          audit
     ──────────────────────────────────────────
L3   sharing       links        files        search
     ──────────────────────────────────────────
L2   auth          access
     ──────────────────────────────────────────
L1   users         nodes        storage
     ──────────────────────────────────────────
L0   common
```

- **L0 `common`** — config, Prisma, error envelope, pagination, string
  handling. Zero domain knowledge. Every module imports it.
- **L1** — domain primitives and adapters. `nodes` owns the tree, `users` owns
  identities, `storage` owns the bucket. None of the three know the others
  exist.
- **L2** — `auth` answers *who is this*, `access` answers *what may they do*.
  Deliberately separate: authentication is about a session, authorization is
  about a node. Conflating them is how a public share route ends up with a
  different permission code path than the private one.
- **L3** — use-cases that combine lower layers. `files` is `nodes` + `storage`.
  `sharing` is `nodes` + `access`. `links` is the anonymous half of `sharing`,
  split out so that "every route in `sharing` requires an owner" is a property
  a test can assert instead of a convention someone maintains. Controllers
  mostly live here.
- **L4** — reactive and scheduled work. Nothing depends on these; they depend
  on everything.

## Why `access` and `sharing` are two modules

`access` owns the `shares` table and the resolver. `sharing` owns the
use-cases that create and revoke grants.

The split exists because of a cycle. A share controller needs the access guard
("only an owner may share this node"), and the access guard needs to read
shares. If one module held both, `sharing → access → sharing`.

Putting the table and the resolver in the lower layer breaks it cleanly, and it
has a second payoff: the resolver ends up as a pure function with no injected
dependencies, so the full permission matrix is a fast unit test instead of an
e2e suite.

## The one place we invert a dependency

`access` needs a node's ancestor chain to resolve inherited grants. `nodes`
controllers need the access guard. That is a genuine cycle.

Resolution: `access` declares a narrow port and never imports `nodes`.

```ts
// access/ports/node-lookup.port.ts
export const NODE_LOOKUP = Symbol('NODE_LOOKUP');

export interface NodeSnapshot {
  id: string;
  rootId: string;
  ownerId: string;
  /**
   * Ancestors, root first, **excluding self**. This is the whole reason the
   * port exists, and it is a list rather than a `path` string on purpose: the
   * ancestor chain is a fact about the tree, whereas a delimited path is one
   * way of storing it. `access` resolving grants must not depend on which way
   * `nodes` chose — see §The shape of the system.
   */
  ancestorIds: readonly string[];
  deletedAt: Date | null;
  /**
   * True if ANY ancestor is soft-deleted.
   *
   * Without this the resolver cannot enforce its own rule. `access` must return
   * `none` when the target *or any ancestor* is deleted, but a snapshot that
   * carries only its own `deletedAt` makes the ancestor half uncomputable — and
   * `resolveAccess` is a pure function, so it cannot go and look. One extra
   * boolean, computed by the repository in the query that already reads the
   * node, keeps the resolver pure and the invariant true.
   */
  ancestorsDeleted: boolean;
}

export interface NodeLookupPort {
  findSnapshot(id: string): Promise<NodeSnapshot | null>;
}
```

`NodesRepository` implements it. The binding happens once, in `AppModule`:

```ts
providers: [{ provide: NODE_LOOKUP, useExisting: NodesRepository }]
```

No `forwardRef` anywhere in the codebase. If you find yourself reaching for
one, a boundary is wrong.

## Request pipeline

```
  ValidationPipe          zod schema from packages/shared
        ↓
  SessionGuard            auth/ — reads Authorization: Bearer or
        ↓                         X-Share-Token, attaches req.actor, NEVER
                                  throws on a missing token (anonymous share
                                  visitors are valid)
  NodeAccessGuard         access/ — loads snapshot + grants, resolves role,
        ↓                           attaches req.access, 404s on denial
  Controller              L3
        ↓
  Service                 L1–L3
        ↓
  PrismaExceptionFilter   common/ — P2002 → 409 NAME_CONFLICT, P2025 → 404
```

Three rules that fall out of this and matter more than they look:

1. **`SessionGuard` returns `null` rather than 401.** The same endpoint serves
   an owner with a JWT and an anonymous visitor with `X-Share-Token`. Routes
   requiring a real user say so via `@RequireAuth()`.
2. **Denial is 404, never 403.** A 403 confirms the id exists, which is an
   enumeration oracle across every room in the system.
3. **No cookies anywhere.** Credentials travel in the `Authorization` header and
   the refresh token travels in a request body. Nothing in the pipeline reads or
   writes `Set-Cookie`, so CSRF has no mechanism to exploit and non-browser
   clients need no special handling.

## Identity: provisioned, not self-service

There is no registration. Users are created from `.env` by the Prisma seed step
(`users/TODO.md` explains why a plain SQL migration cannot do it: Prisma
migrations are static checksummed SQL with no access to `process.env`, and
Postgres cannot compute an argon2id hash). Email and password is the primary
login; a provisioned user may additionally sign in with Google, which **links to
an existing account and never creates one**.

That single rule is what keeps a public OAuth button from becoming a public
signup form, and it is why every login failure returns one indistinguishable
response.

## Shared vocabulary

`packages/shared` holds zod schemas and the error-code union. Both apps import
it. The DTO types are inferred from the schemas, never hand-written, so a
contract change is a compile error on both sides rather than a runtime
surprise.

## Frontend structure

`shared/` holds the API client, error mapping, query-key factory, and UI
primitives. Everything else is a feature folder that owns its own components,
hooks, and API calls.

Feature folders do not import each other. Where they need to compose —
`public-view` rendering the explorer, `explorer` opening the share dialog —
the composition happens at the route level, and the shared component takes a
`readOnly` prop rather than reaching across the boundary.

One deliberate exception to the "server state lives in react-query" rule:
`uploads` keeps its queue in a zustand store. Transfer progress is not server
state, and putting it in the query cache means uploads die on navigation.

## Non-negotiable invariants

These hold system-wide. Each has a test somewhere. The numbering is stable and
referenced by name from the module and suite files — extend it, never renumber.

They fall into two kinds, and the difference decides who is allowed to know
about them. **1–5, 7, 8 are semantics**: true of the product regardless of how
the tree is stored, and safe for any module to rely on. **6 is a consequence**
of the materialized-path strategy `nodes` expects to choose; it is real, it is
load-bearing while that strategy stands, and it is `nodes`' private business. A
module outside `nodes` that finds itself depending on 6 has reached through an
abstraction.

### Semantics

1. Ancestry is exactly what `parent_id` says. Any derived representation — a
   `path` column, a closure table, a cached chain — equals the walk from the
   node to its root, and `depth` equals the number of ancestors. `parent_id` is
   the source of truth; everything else is a rebuildable index.
2. A node may not be moved beneath its own descendant. That silently detaches a
   subtree, and it is the one move that looks legal from the parent's side.
3. `depth` is capped at 32. Under a materialized path this is a hard storage
   limit rather than a policy — a btree entry maxes out near 2704 bytes and a
   UUID path segment is 37 chars, so an uncapped tree fails at ~73 levels with a
   raw Postgres index error. The cap stays at 32 even if the storage strategy
   changes: a 32-deep data room is already past what anyone navigates.
4. A soft-deleted node has all descendants soft-deleted in the same
   transaction, and every grant under it revoked.
5. Names are NFC-normalized before the uniqueness check. `café` in NFD and NFC
   are different byte strings that render identically.
7. Effective permission is the maximum role across the node's own grants and
   all its ancestors' grants.
8. `size_bytes` comes from S3's `HeadObject`, never from the client.

### Consequence of the storage strategy — `nodes` only

6. Nothing user-controlled ever enters `path`. A `%` or `_` in a name would
   break every prefix query in the system. Prefix matching is also only
   unambiguous because **every id is a fixed-length UUID** — with variable-width
   ids, `LIKE '/a/b%'` would match `/a/bc` and every cascade would silently
   over-reach. Ids are UUIDs and stay UUIDs; changing that breaks soft-delete,
   move, and stats at once.
