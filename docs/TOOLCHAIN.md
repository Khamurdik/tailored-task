# Toolchain

Every version in this workspace is pinned exactly (no `^`, no `~`). This file
records why, and — more importantly — records the four places where the newest
release is *not* the right one.

Verified against the npm registry on **2026-08-16**: all 57 required peer
constraints across the five `package.json` files resolve with zero conflicts.

## Runtime

| | Version | Why |
| --- | --- | --- |
| Node | **26.7.0** (`.nvmrc`), floor `>=24.15.0` | Development runs 26; the `engines` floor admits Node 24 LTS. See the caveat below. |
| pnpm | **11.22.0** | Workspaces without a separate task runner. |

All 68 pinned packages were checked against Node 26: 35 declare `engines.node`
and **none exclude it**. `jsdom@30` is the fussiest
(`^22.22.2 || ^24.15.0 || >=26.0.0`) and names 26 explicitly.

### Node 26 is Current, not LTS — until 2026-10-28

v26 released 2026-05-05 and becomes Active LTS on **2026-10-28**, roughly ten
weeks out. Until then it gets the Current line's faster, more disruptive
release cadence. Nothing in this stack objects; the only real consequence is
Corepack, below.

**The `engines` floor was relaxed from `>=26.0.0` to `>=24.15.0` on 2026-08-18**,
in all five manifests, so a deployment target that only offers LTS tags is no
longer blocked. `.nvmrc` still says 26.7.0: development stays on 26 and 24 is
*permitted*, not preferred.

`24.15.0` is not a round number picked for looks. It is `jsdom@30`'s floor on the
24 line — its range is `^22.22.2 || ^24.15.0 || >=26.0.0`, which makes it the
lowest Node 24 the test stack actually installs under.

Anything below the floor now fails at `pnpm install` rather than midway through a
suite — but **that was not true when this line was first written.** The guard was
`engine-strict=true` in `.npmrc`, which pnpm 11 ignores: it reads its settings
from `pnpm-workspace.yaml`, exactly as it does for `allowBuilds`. An install on
Node 26 against an `engines` of `24.x` printed `[WARN] Unsupported engine` and
exited **0**. The working key is `engineStrict: true` in `pnpm-workspace.yaml`,
added 2026-08-18 and checked in all three directions: it passes on 26.7.0 and
24.19.0 and fails on 20.15.0 with `ERR_PNPM_UNSUPPORTED_ENGINE`.

**Verified on 24.19.0 (Latest LTS), not assumed.** Install under `engine-strict`,
`pnpm -r typecheck`, `pnpm lint`, `pnpm build`, 377 tests across all four real
Vitest projects, and the 20 Playwright journeys — all green. The two entry points
that matter most were checked by running them, because both were designed against
Node 26's type-stripping rules and neither is exercised by a compiler:
`prisma/seed.ts` (the strip-safe zone) and `tests/src/registry/cli.ts`. The API
image also builds and serves on a `node:24-slim` base (588 MB against 593 MB),
though `apps/api/Dockerfile` stays on 26 — see DEPLOYMENT-CLOUD.md §2.

### Corepack is gone from Node 25+

**`corepack enable` does not work on Node 26.** Corepack shipped with Node from
14.19.0 up to — but not including — 25.0.0. It is now a standalone package.

**On Node 24 it does work**, and is the shorter path there: `corepack enable`
followed by any pnpm command self-switches to 11.22.0 from the `packageManager`
field. Verified 2026-08-18. This is the one place where the two supported Node
lines need different instructions.

pnpm 10+ reads the `packageManager` field itself
(`manage-package-manager-versions`, on by default), so the simplest path is to
install any recent pnpm globally and let it self-switch to 11.22.0:

```bash
npm i -g pnpm        # npm is still bundled with Node 26 (11.19.0)
```

Under nvm, global packages are per-Node-version, so this must be repeated after
installing a new Node — or carried over with
`nvm install 26.7.0 --reinstall-packages-from=24`.

## The four version decisions that go against "latest"

### 1. TypeScript 6.0.3, not 7.0.2

TypeScript 7 is the Go-native compiler. It is dramatically faster and it *does*
emit `design:paramtypes`, so Nest's DI would work — but **7.0 ships without the
programmatic compiler API**, and two things in this stack are API consumers:

- `nest build` calls `createProgram()` / `program.emit()` with its own transformers
- `typescript-eslint@8.67.0` — peer range `typescript: ">=4.8.4 <6.1.0"`

That peer range *excludes 7 outright*, so this is not a judgement call; a TS 7
pin fails resolution. TypeScript 6.0.3 is the newest release both accept.

> An earlier revision of this file listed `ts-jest@29.4.12` (peer
> `typescript: ">=4.3 <7"`) as a third consumer. Jest was removed when the suite
> moved to `tests/` — see §3 below — so that argument is gone. The pin still
> holds on the two above; it is a weaker case than it was, and worth re-checking
> rather than inheriting.

You still get the fast checker without the risk:

```bash
pnpm typecheck:next   # runs TS 7 as a type-checker only, via npx
```

The API compiler API is expected back in TypeScript 7.1 (`next` is already
`7.1.0-dev`). Revisit then.

### 2. Prisma 6.19.3, not 7.9.1

Prisma 7 is **ESM-only**, requires a **driver adapter** (`@prisma/adapter-pg`)
for every database, and introduces a mandatory `prisma.config.ts`. The official
v7 upgrade guide has no CommonJS path at all.

NestJS builds CommonJS by default. Taking Prisma 7 means converting the API to
ESM — which is its own well-known minefield with decorators and Jest — for no
feature this project needs. Prisma 6 is still actively maintained (it holds the
`prev` dist-tag) and uses the `prisma-client-js` generator with no adapter.

### 3. One runner — Vitest — in a separate `tests` package

Tests do not live in `apps/api` or `apps/web`; the whole suite is
[`tests/`](../tests/TODO.md), and neither app package carries a runner.

That made Jest unnecessary. The original reason for it still stands —
**esbuild does not implement `emitDecoratorMetadata`**, so a NestJS suite under
plain Vitest loses `design:paramtypes` and fails at injector time — but with a
single test project the fix is one plugin rather than a second toolchain:
`unplugin-swc@1.5.11` transforms the `api-*` projects with SWC, which does emit
the metadata. Jest, `ts-jest`, and `@types/jest` are gone.

One runner also means one reporter and one run history, which is the whole point
of the file-based run log.

### 4. `@vitejs/plugin-react-swc`, not `@vitejs/plugin-react`

`@vitejs/plugin-react@6.0.5` pins its peer to `vite: "^8.0.0"` and adds Babel
plugin peers. The SWC variant accepts `vite: "^4 || ^5 || ^6 || ^7 || ^8"` and
vendors `@swc/core` as a real dependency — fewer peers to go wrong, and faster.

## Framework notes that will bite otherwise

**NestJS 11 runs Express 5** (`@nestjs/platform-express@11.2.1` depends on
`express@5.2.1` and `path-to-regexp@8.4.2`). Express 5 changed route syntax:
bare `*` wildcards are invalid. Use `{*splat}`, e.g. `@Get('files/{*path}')`.
This surfaces as a `path-to-regexp` throw at boot, not a 404.

**Tailwind v4 has no `tailwind.config.js` and no `postcss.config.js`.** The
theme lives in [`apps/web/src/index.css`](../apps/web/src/index.css) behind
`@theme inline`, and the build runs as a Vite plugin. Two v3 packages do not
carry over:

- `tailwindcss-animate` → **`tw-animate-css`** (what shadcn uses on v4)
- `tailwind-merge` must be **v3** — v2 does not understand v4's class output

**pnpm 10+ blocks dependency lifecycle scripts by default.** Anything needing a
postinstall to fetch a native binary or generate code must be allowlisted under
`onlyBuiltDependencies` in `pnpm-workspace.yaml`, or it installs "successfully"
and fails at runtime. Currently listed: Prisma (client + engines),
`@tailwindcss/oxide`, `@swc/core`, `esbuild`, `unrs-resolver`.

**`react-router` v8, not `react-router-dom`** — the DOM package was folded in at
v7. It also requires React ≥ 19.2.7, which is why React is pinned at 19.2.8.

**zod 4** is safe here: both consumers that matter — `nestjs-zod@5.5.0` and
`@hookform/resolvers@5.9.0` — declare `zod: "^3.25.0 || ^4.0.0"`.

## Type-aware linting is deliberately off

`eslint.config.base.mjs` uses `tseslint.configs.recommended`, not
`recommendedTypeChecked`. The type-aware rules need a TypeScript Program — the
same API TS 7 removed — so staying syntactic keeps lint working through the
eventual TS 7 move. Turn them on later, together with the 7.1 upgrade.

## Shared package build

`@dataroom/shared` emits **both** CJS and ESM, because its two consumers resolve
differently: the API uses `moduleResolution: node10` (which ignores `exports`
and reads `main` → `dist/cjs`), and Vite uses bundler resolution (which reads
`exports.import` → `dist/esm`). `scripts/fixup.mjs` writes the `{"type": ...}`
marker into each output directory; without it Node reads both as CommonJS and
the ESM named exports break.

Build it before the apps — `pnpm build` at the root already orders this.

## Getting started

```bash
nvm install               # reads .nvmrc → 26.7.0
nvm use
npm i -g pnpm             # NOT corepack — unbundled since Node 25
node --version            # v26.7.0
pnpm --version            # self-switches to 11.22.0 via packageManager

pnpm install
cp apps/api/.env.example apps/api/.env   # then fill it in
pnpm --filter @dataroom/shared build
pnpm db:migrate
pnpm dev
```

`engine-strict=true` is set in `.npmrc`, so an install on the wrong Node fails
immediately with a readable message rather than halfway through.
