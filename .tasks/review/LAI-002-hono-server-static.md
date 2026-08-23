---
id: LAI-002
title: Hono server boots, /api/v1/health responds, static SPA served
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-001]
discovered-from:
status: review
started: 2026-08-24T02:58:00+05:30
finished: 2026-08-24T03:19:46+05:30
---

## Goal

The walking skeleton's spine: one Node process running Hono that answers a
health check and serves static files with SPA fallback, so every later route has
somewhere to mount and the Docker image has something to run.

## Acceptance criteria

- [x] `server/src/index.ts` starts Hono on `@hono/node-server`, port from `PORT`
      (default 3000), host `0.0.0.0`.
- [x] `GET /api/v1/health` returns `200 {"status":"ok","version":"<pkg version>","uptime_ms":N}`.
- [x] Middleware chain wired in the SPEC §11.2 order — `requestId → logger →
      cors → bodyLimit → (auth placeholder) → (rateLimit placeholder) → route →
      errorHandler` — with auth/rateLimit as pass-through stubs for now.
- [x] Errors serialise to the SPEC §6.3 envelope
      `{"error":{"code","message","details"}}`; unhandled errors return
      `internal` with no leaked detail and log the `request_id`.
- [x] Static files served from `server/public/`, with SPA fallback to
      `index.html` for any path that is not `/api/*`, `/mcp*`, or `/webhooks/*`.
- [x] A **committed** fallback document at `server/src/static/fallback.html` is
      served when `server/public/index.html` is absent (PM decision, LAI-016).
      Build output stays fully gitignored — nothing is ever committed into
      `server/public/`.
- [x] The SPA fallback is proven by a test that runs on a **clean clone with no
      SPA build**, depending on no untracked file.
- [x] Graceful shutdown on `SIGTERM`/`SIGINT` (stop accepting, drain, exit 0).
- [x] HTTP tests through Hono's test client cover health, a 404 JSON error, and
      the SPA fallback.

## Notes / context

Milestone: **M1**. SPEC §11.1, §11.2, §11.4, §6.3.

**Resolved by PM (was LAI-016):** `server/public/` is build output and stays
entirely gitignored. Do **not** add a `.gitignore` negation for
`server/public/index.html` — a committed file inside the build output directory
shows as permanently modified once a real build overwrites it. Serve
`server/public/index.html` when it exists, else the committed
`server/src/static/fallback.html`.

Route mounting order matters: API, MCP and webhook prefixes must be matched
before the static/SPA fallback, or the fallback swallows them.

Dependencies this task may add: `hono`, `@hono/node-server`. Logging can be a
thin `console` wrapper emitting JSON — do not add a logging library yet.

---

## Notes at review — builder-a

**Verified on a fresh `git clone` of `builder-a`, not on my working tree.**
`pnpm install --frozen-lockfile` → `typecheck` → `lint` → `test` (50 tests, 7
files) all exit 0. Then the real process, booted with plain `node` on the clean
clone with no `server/public/` present:

```
GET /api/v1/health   → 200 {"status":"ok","version":"0.1.0","uptime_ms":165}
GET /anything        → 200 text/html, the committed fallback document
GET /api/v1/nope     → 404 application/json, §6.3 envelope
GET /mcp             → 404 application/json
GET /webhooks/github → 404 application/json
SIGTERM              → shutdown.start → shutdown.complete → exit 0
```

**1. Two bugs the tests caught, both fixed.**

- Hono routes **only `Error` instances** to `app.onError`. A handler throwing a
  string or a plain object escaped the error handler entirely — under
  `@hono/node-server` that is an unhandled rejection and a dropped connection,
  not the `internal` envelope AC4 requires. Fixed with an `errorBoundary`
  middleware that normalises non-Error throws, keeping the original on `cause`
  so the log still has everything.
- The first status-to-code mapping collapsed every unmapped status to
  `internal`, which would have reported a `405` as a server error. Now any
  unmapped 4xx maps to `bad_request`.

**2. `errorBoundary` is a sixth middleware, and §11.2 lists five.** It is the
front half of the `errorHandler` stage rather than a new stage — the named order
`requestId → logger → cors → bodyLimit → auth → rateLimit → route → errorHandler`
is intact and asserted by tests. Flagging it because it is a visible deviation
from a spec section that says "fixed".

**3. §6.3's error vocabulary cannot express `413`, which every route can now
produce.** `bodyLimit` is mandatory per §13.1. I preserved the accurate HTTP
status and reported the nearest code beside it (`413` → `unprocessable`), so
code and status do not always pair the way §6.3's table implies. Forcing them to
agree would report a `405` as a `422`. **LAI-017 filed** for PM — it is a spec
decision, not a handler's.

**4. Security headers (§13.1) are deliberately not here.** Not in this task's
criteria, not in §11.2's chain, and CSP depends on what Vite emits (LAI-007).
Guessing a policy now means loosening it later. **LAI-018 filed.**

**5. `server` still has no `build` or `start`, and LAI-008 needs both.**
**LAI-019 filed**, carrying a finding that matters for the container: `SIGTERM`
under `tsx` exits **143** and never runs the shutdown handler, because `tsx`
forks and does not forward the signal. Under plain `node` it exits **0**. The
container entrypoint must be `node` directly — not `tsx`, not `pnpm start` — or
`docker stop` escalates to `SIGKILL` on every deploy.

**6. CORS denies all cross-origin by default.** The SPA is same-origin in
production and behind Vite's proxy in development, so nothing legitimate needs a
grant yet. Widening it should be a decision someone makes on purpose.

**7. `server/tsconfig.json` gained `allowImportingTsExtensions` and
`rewriteRelativeImportExtensions`.** Source imports carry explicit `.ts`
specifiers, which is what lets the same files run under `tsx` now and be emitted
as valid Node ESM by `tsc` later. This is the concrete answer to the
`moduleResolution: bundler` risk I flagged in the LAI-001 log. Both options are
in `server/`, not in the shared `tsconfig.base.json`.
