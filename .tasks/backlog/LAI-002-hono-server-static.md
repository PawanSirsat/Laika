---
id: LAI-002
title: Hono server boots, /api/v1/health responds, static SPA served
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-001]
discovered-from:
status: backlog
---

## Goal

The walking skeleton's spine: one Node process running Hono that answers a
health check and serves static files with SPA fallback, so every later route has
somewhere to mount and the Docker image has something to run.

## Acceptance criteria

- [ ] `server/src/index.ts` starts Hono on `@hono/node-server`, port from `PORT`
      (default 3000), host `0.0.0.0`.
- [ ] `GET /api/v1/health` returns `200 {"status":"ok","version":"<pkg version>","uptime_ms":N}`.
- [ ] Middleware chain wired in the SPEC §10.2 order — `requestId → logger →
      cors → bodyLimit → (auth placeholder) → (rateLimit placeholder) → route →
      errorHandler` — with auth/rateLimit as pass-through stubs for now.
- [ ] Errors serialise to the SPEC §6.3 envelope
      `{"error":{"code","message","details"}}`; unhandled errors return
      `internal` with no leaked detail and log the `request_id`.
- [ ] Static files served from `server/public/`, with SPA fallback to
      `index.html` for any path that is not `/api/*`, `/mcp*`, or `/webhooks/*`.
- [ ] A placeholder `server/public/index.html` exists so the fallback is testable
      before the real SPA lands.
- [ ] Graceful shutdown on `SIGTERM`/`SIGINT` (stop accepting, drain, exit 0).
- [ ] HTTP tests through Hono's test client cover health, a 404 JSON error, and
      the SPA fallback.

## Notes / context

Milestone: **M1**. SPEC §10.1, §10.2, §10.4, §6.3.

Route mounting order matters: API, MCP and webhook prefixes must be matched
before the static/SPA fallback, or the fallback swallows them.

Dependencies this task may add: `hono`, `@hono/node-server`. Logging can be a
thin `console` wrapper emitting JSON — do not add a logging library yet.
