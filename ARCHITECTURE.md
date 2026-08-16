# Architecture

## The shape of the system

A Data Room is a tree. Rooms, folders, and files are rows in one `nodes` table
discriminated by `type`, linked by `parent_id`, with a materialized `path`
column carrying the ancestor id chain.

Everything else in the backend is one of three things: something that owns a
piece of that tree's lifecycle, something that evaluates who may touch it, or
plumbing.

## Layers

A module may import from any layer strictly below it, never from its own layer
except where noted, and never from above.

```
L4   jobs          audit
     ──────────────────────────────────────────
L3   sharing       files        search
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
  `sharing` is `nodes` + `access`. Controllers mostly live here.
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

`access` needs to read node paths to walk the ancestor chain. `nodes`
controllers need the access guard. That is a genuine cycle.

Resolution: `access` declares a narrow port and never imports `nodes`.

```ts
// access/ports/node-lookup.port.ts
export const NODE_LOOKUP = Symbol('NODE_LOOKUP');

export interface NodeSnapshot {
  id: string;
  rootId: string;
  ownerId: string;
  path: string;
  deletedAt: Date | null;
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
  SessionGuard            auth/ — attaches req.actor, NEVER throws on missing
        ↓                         token (anonymous share visitors are valid)
  NodeAccessGuard         access/ — loads snapshot + grants, resolves role,
        ↓                           attaches req.access, 404s on denial
  Controller              L3
        ↓
  Service                 L1–L3
        ↓
  PrismaExceptionFilter   common/ — P2002 → 409 NAME_CONFLICT, P2025 → 404
```

Two rules that fall out of this and matter more than they look:

1. **`SessionGuard` returns `null` rather than 401.** The same endpoint serves
   an owner with a JWT and an anonymous visitor with `X-Share-Token`. Routes
   requiring a real user say so via `@RequireAuth()`.
2. **Denial is 404, never 403.** A 403 confirms the id exists, which is an
   enumeration oracle across every room in the system.

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

These hold system-wide. Each has a test somewhere.

1. `path` always equals the concatenation of ancestor ids ending in self, and
   `depth` equals segment count minus one. `parent_id` is the source of truth;
   `path` is a rebuildable derived index.
2. No node's `path` may be a prefix of its own new parent's path — that is a
   move into your own descendant, and it silently detaches a subtree.
3. `depth` is capped at 32. A btree entry maxes out near 2704 bytes and a UUID
   path segment is 37 chars, so an uncapped tree fails at ~73 levels with a raw
   Postgres index error.
4. A soft-deleted node has all descendants soft-deleted in the same
   transaction, and every grant under it revoked.
5. Names are NFC-normalized before the uniqueness check. `café` in NFD and NFC
   are different byte strings that render identically.
6. Nothing user-controlled ever enters `path`. A `%` or `_` in a name would
   break every prefix query in the system.
7. Effective permission is the maximum role across the node's own grants and
   all its ancestors' grants.
8. `size_bytes` comes from S3's `HeadObject`, never from the client.
