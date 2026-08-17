# web/shared/mock — the placeholder data layer

## Purpose
Lets the entire web app be built, run, and demonstrated before the API exists,
by answering its HTTP calls from fixtures held in memory. Off in production, and
structurally incapable of being on by accident.

## Owns
The fixtures, the in-memory store they seed, and the fake transport. No feature
folder knows this exists.

## Public surface
- `installMockTransport(instance)` — swaps the axios adapter
- `resetMockDb()` — back to the fixtures. For tests and for a "reset demo" button

## Depends on
`packages/shared` (the schemas), `axios` (the adapter type). Nothing else, and
**no new dependency** — see the comparison below.

---

## 1. Where the fake goes, and why that is the whole decision

The fixtures are the easy part. The only interesting question is *at what layer*
the app stops talking to a real thing, because everything below that layer stops
being exercised — and whatever is not exercised is not built, only written.

```
  feature hooks          useChildren(), useCreateFolder()
        ↓
  react-query            cache, invalidation, retry policy
        ↓
  api client             ← swap here and you skip everything below
        ↓
  axios interceptors     bearer header, 401 → refresh, single-flight lock
        ↓
  axios adapter          ← SWAP HERE
        ↓
  XMLHttpRequest         (never runs in mock mode)
```

**The adapter is the lowest seam that is still inside the front end.** Axios
takes an `adapter` function — it hands you a config and expects a response — so
replacing it fakes the network and nothing else. Everything above keeps running
for real:

- the request interceptor still attaches `Authorization: Bearer`;
- a 401 still triggers the refresh path, still takes the
  `navigator.locks` single-flight lock, still retries once;
- responses are still parsed against the shared schemas, so
  `WEB-SHARED-027` is testable;
- react-query still caches, still invalidates the `['nodes']` prefix, still
  refetches on focus.

Swapping one layer higher — a fake `api` object, or fixtures returned straight
from the hooks — would leave the refresh logic unrun until the day the real API
appears. That logic is the highest-risk code in `web/shared`
(`WEB-SHARED-004` and `WEB-SHARED-028` are both `P0`), and the failure it
guards against only shows up under a burst of parallel requests. A mock that
skips it hides exactly the bug it should help find.

### Alternatives, and why not

| | Why not |
| --- | --- |
| **MSW** | The usual answer, and a good tool. It is a dependency, it intercepts at the network boundary via a service worker, and it needs its own worker file served in dev. The adapter seam gets the same coverage with none of that, because this app has exactly one HTTP client and it is already ours. |
| **Static JSON in `public/`** | Read-only. Create, rename, move, delete, upload, share and revoke are most of the product, and none of them can be built against files that never change. |
| **A fake `api` object** | Skips interceptors, error mapping, and schema parsing — see above. |
| **`json-server` or similar** | A second process to run, and it is an API. The point of the request was to stay inside the front end. |

---

## 2. Fixtures are validated against the contract, not trusted

**Every fixture is parsed through the zod schema from `packages/shared` when the
store loads, and a failure throws at startup with the offending path.**

This is what separates a useful mock from an expensive lie. A placeholder JSON
that drifts from the contract teaches the UI a shape the server will never send,
and the divergence surfaces months later as "it worked with mocks". Since the
contract is already zod, checking costs one `parse` per fixture and turns a
contract change into a loud failure in the mock rather than a quiet one.

- [ ] Fixtures live as `.json`, so they read as data and can be edited by
      someone who is not reading TypeScript
- [ ] Every response the store produces is parsed through its response schema
      **in dev**, not just on load — a handler that builds a malformed page is
      the same bug as a malformed fixture
- [ ] A fixture referencing a missing `parentId` or `ownerId` fails at load.
      Referential nonsense is the other half of "valid but wrong"

---

## 3. It behaves like the system, not like a JSON file

The value is in the semantics the specs already argue for. A mock that returns
rows but gets these wrong produces a front end that is confidently incorrect.

- [ ] **Denial is 404, never 403.** The same rule as the API. A share token
      requesting a node outside its subtree gets the same body as one requesting
      an id that never existed
- [ ] **Share scoping**, so `public-view` can be built honestly: a grant on
      folder B resolves on B and its descendants and nowhere else
- [ ] **Keyset pagination** with an opaque cursor, folders before files, name
      order — so the explorer's paging is real and its cursor is not an index
- [ ] **Name conflicts** return 409 `NAME_CONFLICT` with a `suggestedName`,
      because the conflict dialog is a real screen
- [ ] **Cascade soft-delete**, and grants under a deleted node stop resolving
- [ ] **Ancestry is computed from `parentId`**, exactly as the contract says —
      no `path` string anywhere, so the mock cannot teach the UI a shape that
      belongs to one storage strategy
- [ ] **Simulated latency** (a configurable 120–400ms) so loading and empty
      states are visible during development rather than discovered in staging
- [ ] Mutations persist for the session, so a demo can create a folder, upload
      into it, share it, and revoke the link

### What it deliberately does not do
- No real presigned URLs. `/uploads/init` returns a `mock://` URL the fake
  transport recognises, and the bytes are kept in memory.
- No argon2, no JWT signature. Tokens are opaque strings; the fake checks that
  one was presented, never that it was valid.
- **No authorisation logic beyond share scoping.** Owner-vs-stranger is modelled
  because `public-view` depends on it; the full role matrix is `access`'s job
  and duplicating it here would create the second copy of the permission rules
  that the pure-resolver design exists to prevent.

---

## 4. It cannot ship on

- [ ] Enabled only when `import.meta.env.VITE_API_MODE === 'mock'`
- [ ] The mode is read in **one** file, next to where the adapter is installed
- [ ] `import.meta.env.PROD` forces it off regardless of the flag, so a stray
      `VITE_API_MODE=mock` in a production build cannot serve fixtures to real
      users
- [ ] Dev builds log one line at startup naming the mode, because "why is my
      data not saving" is otherwise a long afternoon

## Tests

> These are the **requirements**. They are declared in
> [`tests/suites/web/shared/TODO.md`](../../../../../tests/suites/web/shared/TODO.md).
- [ ] Every fixture parses against its schema (this is the load-time check,
      asserted rather than assumed)
- [ ] The mock is off when `PROD` is true, whatever the flag says
- [ ] A share token cannot read a sibling subtree — same body as a missing id

## Done when
`VITE_API_MODE=mock pnpm dev:web` gives a working data room with no API, no
database and no bucket running, and switching the flag to `live` changes nothing
above the adapter.
