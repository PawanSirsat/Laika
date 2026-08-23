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
RUN if [ -f server/web/package.json ]; then \
      pnpm --filter @laika/web build; \
    else \
      echo "no server/web — building an empty public/ (LAI-017 not landed)"; \
    fi; \
    mkdir -p /out && cp -R server/public/. /out/ 2>/dev/null || true

# ---------------------------------------------------------------------------
# server — TypeScript to JavaScript.
#
# PROVISIONAL: tsc is invoked directly with flag overrides because
# @laika/server has no build script and server/ is Builder-A's area
# (LAI-024, plus LAI-201 for the migrations assets). The shared tsconfig sets
# noEmit for typechecking, so the
# emit flags have to be forced from here.
# When LAI-024 lands, this whole RUN becomes:
#     RUN pnpm --filter @laika/server build
# ---------------------------------------------------------------------------
FROM deps AS server
WORKDIR /app
COPY . .
# tsconfig.json's `include` also covers test/ and the vitest/drizzle configs,
# and `--project` cannot be narrowed with file arguments (TS5042). So compile
# everything here and ship only dist/src — the test output never leaves this
# stage. tsc infers server/ as the common root, hence the src/ prefix.
RUN pnpm exec tsc \
      --project server/tsconfig.json \
      --noEmit false \
      --outDir /build/out \
      --sourceMap false \
      --declaration false \
 && test -f /build/out/src/index.js \
 && mv /build/out/src /build/dist \
 && test ! -e /build/dist/index.test.js

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
COPY --from=server    --chown=root:root /build/dist ./dist

# paths.ts resolves the fallback document relative to the package root, so it
# must exist at server/src/static/ even in a compiled image (LAI-016).
COPY --chown=root:root server/src/static ./src/static

# tsc emits JavaScript and nothing else, so the generated migrations — .sql and
# meta/*.json — are not in dist. migrate.ts resolves them from import.meta.url,
# i.e. beside the compiled module, so they have to land at dist/db/migrations.
# Without this the container boots, fails with "Can't find meta/_journal.json",
# and restart-loops.
COPY --chown=root:root server/src/db/migrations ./dist/db/migrations

# Empty unless the SPA stage produced a build. The server falls back to
# src/static/fallback.html when public/index.html is absent.
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
