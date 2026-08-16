# Toolchain

Every version in this workspace is pinned exactly (no `^`, no `~`). This file
records why, and — more importantly — records the four places where the newest
release is *not* the right one.

Verified against the npm registry on **2026-08-16**: all 53 required peer
constraints across the four `package.json` files resolve with zero conflicts.

## Runtime

| | Version | Why |
| --- | --- | --- |
| Node | **≥ 24.15.0** | v24 (Krypton) is Active LTS until 2028-04-30. v20 went EOL 2026-04-30; v22 is in maintenance. |
| pnpm | **11.22.0** | Workspaces without a separate task runner. |

The `.15.0` is not cosmetic. `jsdom@30` declares
`engines: ^22.22.2 || ^24.15.0 || >=26.0.0` — a plain `>=24` lets Node 24.13
install and then fail. `react-router@8` independently requires `>=22.22.0`.

## The four version decisions that go against "latest"

### 1. TypeScript 6.0.3, not 7.0.2

TypeScript 7 is the Go-native compiler. It is dramatically faster and it *does*
emit `design:paramtypes`, so Nest's DI would work — but **7.0 ships without the
programmatic compiler API**, and three things in this stack are API consumers:

- `nest build` calls `createProgram()` / `program.emit()` with its own transformers
- `ts-jest@29.4.12` — peer range `typescript: ">=4.3 <7"`
- `typescript-eslint@8.67.0` — peer range `typescript: ">=4.8.4 <6.1.0"`

Both peer ranges *exclude 7 outright*, so this is not a judgement call; a TS 7
pin fails resolution. TypeScript 6.0.3 is the newest release all three accept.

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

### 3. Jest for the API, Vitest only for the web

Vitest transforms with esbuild, and **esbuild does not implement
`emitDecoratorMetadata`**. A NestJS suite under Vitest silently loses
`design:paramtypes` and fails at injector time, unless you bolt on `unplugin-swc`.
Jest 30 + `ts-jest` 29 uses the real TypeScript compiler, so tests see exactly
what `nest build` produces. The web app has no decorators, so Vitest 4 is the
natural fit there.

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
corepack enable && corepack prepare pnpm@11.22.0 --activate
node --version            # must be >= 24.15.0
pnpm install
cp apps/api/.env.example apps/api/.env   # then fill it in
pnpm --filter @dataroom/shared build
pnpm db:migrate
pnpm dev
```

`engine-strict=true` is set in `.npmrc`, so an install on the wrong Node fails
immediately with a readable message rather than halfway through.
