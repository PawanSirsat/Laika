---
id: LAI-008
title: Dockerfile, compose, and Caddyfile example — one image, /data volume
area: docker
assignee: unclaimed
priority: p1
depends-on: [LAI-001, LAI-002]
discovered-from:
status: backlog
---

## Goal

Package Laika as the single container it is meant to be: one image, one process,
one volume at `/data`. Someone with Docker and no Node toolchain should get a
running server from `docker compose up`.

## Acceptance criteria

- [ ] `docker/Dockerfile`, multi-stage: install deps → build SPA → build server →
      slim runtime stage carrying only production artefacts.
- [ ] Runtime stage runs as a **non-root** user that owns `/data`; `node` is
      PID-appropriate (tini or `--init`) so `SIGTERM` reaches the process.
- [ ] Exactly one declared `VOLUME /data`; the image contains no database file.
- [ ] `HEALTHCHECK` hits `GET /api/v1/health`.
- [ ] `docker/docker-compose.yml`: the image, a named volume mounted at `/data`,
      port mapping, and env — `PORT`, `LAIKA_SECRET`, `LAIKA_DB_PATH=/data/laika.db`,
      `NODE_ENV=production`.
- [ ] `LAIKA_SECRET` is **required** — the container exits with a clear message
      if it is unset, rather than starting insecurely.
- [ ] `docker/Caddyfile.example` terminating TLS and reverse-proxying to the
      container, with a comment explaining SSE needs buffering disabled.
- [ ] `docker/.dockerignore` keeps `node_modules`, `.git`, `.tasks`, `logs`, and
      local databases out of the build context.
- [ ] `docker compose up --build` serves the health endpoint and the SPA
      placeholder; data survives `docker compose down && up` (not `down -v`).
- [ ] `docker/README.md` documents build, run, env vars, and backup (copy
      `/data`).

## Notes / context

Milestone: **M1**. SPEC §10.7, DECISIONS D-002. **Builder-B owns this.**

You depend on LAI-001/LAI-002 for a buildable server, but you can write the
Dockerfile and iterate against the placeholder health route as soon as LAI-002
is in review — coordinate through the board, not by editing `server/`.

If the build needs a change inside `server/` (a script, an output path), **do not
make it** — file a task with `area: server` and `discovered-from: LAI-008`.
