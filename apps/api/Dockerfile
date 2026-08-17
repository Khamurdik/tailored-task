# The API image. Built from the repository root, not from this directory:
#
#     docker build -f apps/api/Dockerfile -t dataroom-api .
#
# The context has to be the root because `@dataroom/api` depends on
# `@dataroom/shared` through `workspace:*`, and a build context that starts at
# `apps/api/` cannot see it.
#
# What this image is and is not:
#   - it is the API server, and nothing else;
#   - it does NOT run migrations or the seed. Both are deliberate, separate
#     steps — `prisma migrate deploy` is not idempotent in the sense operators
#     assume, and `db:seed` is the only thing in the system that creates a user.
#     See DEPLOYMENT.md §4, which runs both from a workstation against the
#     production DATABASE_URL.

# ---------------------------------------------------------------------------
# base — the toolchain, shared by every later stage
# ---------------------------------------------------------------------------
# 26-slim is Node 26.7.0 exactly, which is what `.nvmrc` pins. It also already
# carries libssl.so.3, which is the only system library Prisma's query engine
# needs — hence no apt layer here. (The `openssl` *binary* is absent; Prisma
# does not use it.)
FROM node:26-slim AS base

# Corepack was unbundled from Node 25+, so `corepack enable` is not the install
# path — see DEPLOYMENT.md §1. The version matches the root `packageManager`
# field; pnpm 10+ would self-switch anyway, but pinning keeps the image
# reproducible.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm i -g pnpm@11.22.0

WORKDIR /app

# ---------------------------------------------------------------------------
# deps — install against the manifests alone, so the layer caches
# ---------------------------------------------------------------------------
FROM base AS deps

# Every workspace manifest, because `pnpm install --frozen-lockfile` validates
# the lockfile against the whole workspace even when it only installs part of
# it. Sources are deliberately not here: touching a `.ts` file must not
# invalidate the install layer.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY tests/package.json ./tests/

# `apps/api` has a `postinstall` of `prisma generate`, which reads the schema —
# so the schema has to be present before install, not after.
COPY apps/api/prisma ./apps/api/prisma

# `...` includes each package's workspace dependencies. `apps/web` and `tests`
# are never installed: neither is in the API's dependency graph, and `tests`
# alone pulls Playwright.
RUN pnpm install --frozen-lockfile --filter @dataroom/api... --filter @dataroom/shared...

# ---------------------------------------------------------------------------
# build — compile shared, then the API
# ---------------------------------------------------------------------------
FROM deps AS build

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# `shared` first and explicitly. It emits CJS *and* ESM and both apps resolve it
# through `dist/`; nothing builds it implicitly, which is the same trap
# DEPLOYMENT.md §3 calls out for local development.
RUN pnpm --filter @dataroom/shared build
RUN pnpm --filter @dataroom/api build

# The production dependency tree, with `@dataroom/shared` injected as a real
# directory rather than a symlink into the workspace — which is what makes the
# result copyable into an image that has no workspace.
#
# `--no-scripts`: the API's own `postinstall` is `prisma generate`, and `prisma`
# is a devDependency, so it is absent from a `--prod` tree by definition. The
# client is generated in the next step instead, using the CLI that still exists
# here in the build stage.
#
# `--legacy`: since pnpm 10, `deploy` refuses to run unless the workspace sets
# `inject-workspace-packages=true`. Setting that in `pnpm-workspace.yaml` would
# change how *every* local install links `@dataroom/shared` — a workspace-wide
# change to serve one container build. The flag keeps the blast radius here.
RUN pnpm deploy --filter @dataroom/api --prod --no-scripts --legacy /app/deploy

# Generate the Prisma client *into the deployed tree*. Run from `/app/deploy`
# so the CLI resolves `@prisma/client` there and writes the client beside it;
# generating in `/app` instead would put it in a node_modules the final image
# never receives.
#
# The CLI is at `apps/api/node_modules/.bin`, not the workspace root: pnpm links
# a package's bins beside that package, and `prisma` is a dependency of
# `@dataroom/api` rather than of the root.
RUN cd /app/deploy && /app/apps/api/node_modules/.bin/prisma generate --schema=./prisma/schema.prisma

# ---------------------------------------------------------------------------
# runner — dist, production node_modules, and nothing else
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production
# The config defaults to 3000 (common/config/env.schema.ts). Set explicitly so
# the platform's port and the app's port cannot drift apart silently.
ENV PORT=3000

# The `node` user ships with the image. Running as root is the default nobody
# chose, and this process needs to write nothing.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /app/deploy /app

EXPOSE 3000

# Local convenience only — App Runner polls /health itself over HTTP, and this
# HEALTHCHECK is not what it reads. /health deliberately touches no database:
# a query here keeps Neon from scaling to zero. See DEPLOYMENT.md §5.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `node dist/main`, matching `start:prod` — and NOT `start`, which reads a local
# `.env`. Configuration in a deployment comes from the platform's environment;
# a container that quietly prefers a baked-in file is how a staging image ends
# up pointed at a developer's database.
CMD ["node", "dist/main"]
