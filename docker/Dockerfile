# syntax=docker/dockerfile:1.7
#
# Laika — one image, one process, one volume at /data (D-002, SPEC §11.7).
#
# Build context is the REPO ROOT, not docker/:
#   docker build -f docker/Dockerfile .
# The ignore list lives at docker/Dockerfile.dockerignore — BuildKit reads that
# in preference to a context-root .dockerignore, which keeps every file this
# image needs inside Builder-B's area.
#
# Stages: deps -> web -> server -> prod-deps -> runtime.
# Only the last stage ships. It carries compiled JS and production node_modules;
# no TypeScript, no toolchain, no source maps, and no database.

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.32.1

# ---------------------------------------------------------------------------
# deps — the full workspace install, used only for building.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Manifests first: this layer is cached until a dependency actually changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY server/package.json server/
COPY server/web/package.json server/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# web — the SPA build.
#
# server/web/ does not exist yet (LAI-017, blocked on LAI-022), so this stage
# currently produces an empty directory. It is a real stage rather than a TODO
# so that landing the SPA is a one-line change here, not a restructure. The
# server serves src/static/fallback.html whenever public/index.html is absent
# (LAI-016), which is why an empty public/ is a valid image and not a broken one.
# ---------------------------------------------------------------------------
FROM deps AS web
WORKDIR /app
COPY . .
# `pnpm build` writes to server/public via vite's outDir. No `|| true` here:
# an SPA that fails to build must fail the image, not ship an empty public/ and
# surface as a 500 on `GET /` at runtime. That is exactly what happened when
# this stage swallowed the error (LAI-033).
RUN pnpm --filter @laika/web build \
 && test -f server/public/index.html \
 && mkdir -p /out && cp -R server/public/. /out/

# ---------------------------------------------------------------------------
# server — TypeScript to JavaScript, via the package's own build script.
#
# ---------------------------------------------------------------------------
FROM deps AS server
WORKDIR /app
COPY . .
# `build` = clean + tsc -p tsconfig.build.json + build:assets, and build:assets
# copies src/static and src/db/migrations into dist/ — both non-TypeScript and
# both required at runtime. This Dockerfile used to run tsc itself and copy the
# assets by hand; when the server moved the fallback to dist/static/ the
# hand-rolled copy kept putting it in src/static/ and `GET /` started 500ing.
# Calling the package's own build script is what keeps that from recurring.
RUN pnpm --filter @laika/server build \
 && test -f /app/server/dist/index.js \
 && test -f /app/server/dist/static/fallback.html \
 && test -f /app/server/dist/db/migrations/meta/_journal.json

# ---------------------------------------------------------------------------
# prod-deps — production dependencies only, flattened.
#
# `pnpm deploy` resolves the workspace's symlinked (node-linker=isolated)
# layout into a self-contained node_modules that survives a COPY between
# stages. Copying the isolated tree directly would ship dangling symlinks.
# ---------------------------------------------------------------------------
FROM deps AS prod-deps
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm deploy --filter=@laika/server --prod --legacy /prod \
 && test -d /prod/node_modules/better-sqlite3

# ---------------------------------------------------------------------------
# runtime — what actually ships.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# tini reaps zombies and forwards SIGTERM to node, so the graceful shutdown
# Builder-A wired in LAI-002 actually runs instead of the container being killed.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    LAIKA_DB_PATH=/data/laika.db

# node:*-slim ships a `node` user (uid 1000). Reusing it avoids inventing a
# second unprivileged identity, and /data is chowned to it below.
WORKDIR /app/server

COPY --from=prod-deps --chown=root:root /prod/node_modules ./node_modules
COPY --from=prod-deps --chown=root:root /prod/package.json ./package.json

# dist already carries the fallback document and the generated migrations —
# `build:assets` puts them there. Nothing is copied by hand any more.
COPY --from=server    --chown=root:root /app/server/dist ./dist

# The built SPA. The server falls back to dist/static/fallback.html only when
# public/index.html is absent, which after LAI-017 should never be the case in
# a built image — the web stage fails the build rather than shipping an empty
# directory.
COPY --from=web --chown=root:root /out ./public

COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/laika-entrypoint
RUN chmod 0755 /usr/local/bin/laika-entrypoint

# The database must live in the volume, never in the image. Creating /data here
# and handing it to `node` means the bind or named volume mounts over a
# directory that already has the right owner.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

# Uses the server's own health route (LAI-002). No curl in the image — one
# fewer package, and node is already here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT||3000}/api/v1/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/laika-entrypoint"]
CMD ["node", "dist/index.js"]
