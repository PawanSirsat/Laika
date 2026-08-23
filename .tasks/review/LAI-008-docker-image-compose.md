---
id: LAI-008
title: Dockerfile, compose, and Caddyfile example — one image, /data volume
area: docker
assignee: builder-b
priority: p1
depends-on: [LAI-001, LAI-002]
discovered-from:
status: review
finished: 2026-08-24T04:06:54+05:30
started: 2026-08-24T03:52:33+05:30
---

## Goal

Package Laika as the single container it is meant to be: one image, one process,
one volume at `/data`. Someone with Docker and no Node toolchain should get a
running server from `docker compose up`.

## Acceptance criteria

- [x] `docker/Dockerfile`, multi-stage: install deps → build SPA → build server →
      slim runtime stage carrying only production artefacts.
- [x] Runtime stage runs as a **non-root** user that owns `/data`; `node` is
      PID-appropriate (tini or `--init`) so `SIGTERM` reaches the process.
- [x] Exactly one declared `VOLUME /data`; the image contains no database file.
- [x] `HEALTHCHECK` hits `GET /api/v1/health`.
- [x] `docker/docker-compose.yml`: the image, a named volume mounted at `/data`,
      port mapping, and env — `PORT`, `LAIKA_SECRET`, `LAIKA_DB_PATH=/data/laika.db`,
      `NODE_ENV=production`.
- [x] `LAIKA_SECRET` is **required** — the container exits with a clear message
      if it is unset, rather than starting insecurely.
- [x] `docker/Caddyfile.example` terminating TLS and reverse-proxying to the
      container, with a comment explaining SSE needs buffering disabled.
- [x] `docker/.dockerignore` keeps `node_modules`, `.git`, `.tasks`, `logs`, and
      local databases out of the build context.
- [x] `docker compose up --build` serves the health endpoint and the SPA
      placeholder; data survives `docker compose down && up` (not `down -v`).
- [x] `docker/README.md` documents build, run, env vars, and backup (copy
      `/data`).

## Notes / context

Milestone: **M1**. SPEC §11.7, DECISIONS D-002. **Builder-B owns this.**

You depend on LAI-001/LAI-002 for a buildable server, but you can write the
Dockerfile and iterate against the placeholder health route as soon as LAI-002
is in review — coordinate through the board, not by editing `server/`.

If the build needs a change inside `server/` (a script, an output path), **do not
make it** — file a task with `area: server` and `discovered-from: LAI-008`.

## Implementation notes for review (Builder-B)

Everything below was run, not reasoned about. Docker was available, so the
container was built and exercised rather than inspected on paper.

### Verified

- `docker build -f docker/Dockerfile -t laika:local .` succeeds.
- `docker compose up --build` reaches **healthy in ~6s**; `GET /api/v1/health`
  returns `{"status":"ok","version":"0.1.0",...}`.
- `/` serves the LAI-016 fallback document; `/projects/foo` also returns 200
  (SPA fallback); `/api/v1/nope` still returns the JSON 404 envelope rather than
  HTML, so the fallback is not swallowing the API.
- **Persistence**: wrote a marker row, `docker compose down && up` — marker
  survived. Then the documented backup procedure was exercised for real: tar the
  volume, `down -v` to destroy it, recreate, restore, boot — marker still there.
- **Non-root**: `uid=1000(node)`, `/data` owned by `node`.
- **No database in the image**: `find / -name '*.db'` inside the image returns
  nothing.
- **SIGTERM**: `docker compose stop` returns in 0s with exit code 0 and logs
  `shutdown.start` / `shutdown.complete` — LAI-002's graceful shutdown is
  reached, not SIGKILLed after the timeout.
- **Runtime is clean**: no `typescript`, `tsx`, `vitest` or `drizzle-kit` in the
  image; `dist/` contains only compiled `src`, no test output.
- **Secret guard**: no secret → refuses with a paragraph explaining what it is
  and how to generate one; 8-char secret → refuses; valid secret → starts.
  Compose refuses even earlier, at interpolation.
- **Caddyfile validates** — `caddy validate` via `caddy:2-alpine`, "Valid
  configuration".
- Image is 415MB (node:22-bookworm-slim base plus production deps).

### Three deviations PM should rule on

**1. `docker/Dockerfile.dockerignore`, not `docker/.dockerignore`.** Criterion 8
names the latter. It cannot work: the build context is the repo root (the image
needs `server/`), and Docker reads the ignore list from the context root — so a
functioning `.dockerignore` would be a **new repo-root file**, which is not
Builder-B's to add. BuildKit checks `<dockerfile>.dockerignore` first, so the
chosen name does the same job inside `docker/`. Verified by the file actually
taking effect: an early build failed because it excluded `docker/`, which is how
I know it is being read. Requires BuildKit — default since Docker 23.

**2. `docker/env.example`, not `.env.example`.** The repo-root `.gitignore` has
`.env*`, which swallows the dot-prefixed name — `git check-ignore` confirmed it.
An example file nobody can see is worse than none.

**3. The server is compiled by `tsc` invoked from the Dockerfile.**
`@laika/server` has no `build` script and `server/` is Builder-A's, so the task's
own instruction applies: do not make it, file it. → **LAI-024** (Builder-A had already filed it from LAI-002). The Dockerfile
marks the block PROVISIONAL and names the one-line replacement.

### Discovered work filed

- **LAI-201** (`area: server`, p2) — the migrations trap below. I first filed a
  whole build-script task (LAI-023), then found Builder-A had already filed
  **LAI-024** from LAI-002, better scoped and with a `SIGTERM`-under-`tsx`
  finding mine lacked. Mine is withdrawn; LAI-201 carries only the one thing
  LAI-024 is missing.
- **LAI-202** (`area: docs`, p3) — `LAIKA_SECRET` (this task) vs `SERVER_SECRET`
  (SPEC §11.7). The entrypoint accepts and normalises both as a bridge; nothing
  reads either yet.
- **LAI-203** (`area: docs`, p2) — `pnpm format` is red repo-wide on the
  imported `docs/design/` files, and was already red on `master` before this
  branch. My own files pass. Adjacent to LAI-026 but not the same: that one is
  about `format:fix` writing across areas, this one about the check never
  passing.

Ids renumbered into LAI-200–299 per D-017 after all three collided with
Builder-A's; the integrated ids won, as PM ruled on LAI-200.

### The bug worth knowing about

`tsc` emits JavaScript and nothing else, so the generated migrations
(`src/db/migrations/*.sql` and `meta/_journal.json`) never reached `dist`. The
container built fine, booted, then died with `Can't find meta/_journal.json` and
restart-looped. `migrate.ts` resolves them from `import.meta.url`, so they must
sit beside the compiled module — the Dockerfile now copies them to
`dist/db/migrations`. Anyone writing the real build script (LAI-024) will hit
exactly this; LAI-201 exists to add it as a criterion there.

Second, smaller: compose's `init: true` put Docker's init at PID 1 and demoted
tini to a child, which logged that subreaping was disabled on every boot. One
init, and it is the image's — removed from compose.

### Known gap, stated plainly

The `web` stage produces an **empty** `public/` because `server/web/` does not
exist yet (LAI-017, blocked on LAI-022). Criterion 1 says "build SPA"; there is
a real stage that will build it, and it is a one-line change when the SPA lands.
The container is correct today because LAI-016's fallback covers exactly this
case — which is why `docker compose up` still serves a page.
