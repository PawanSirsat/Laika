---
id: LAI-722
title: 'Performance phase 1 — cache, compress and keep alive what the server sends; fix activity paging; LIMIT the task list'
area: server
assignee: owner-direct
priority: p1
depends-on: []
status: review
started: 2026-10-08T11:05:00Z
finished: 2026-10-08T11:55:00Z
---

## Goal

Made on the owner's direct instruction; performance phase 1. The owner says the
deployed app feels slow. Two read-only investigations of `master` (1f06924)
found the server answers in 1–5 ms and the time goes on the wire: about 215 ms
per round trip to `us-east-1` over HTTP/1.1, every response uncompressed (JS
711 KB, CSS 239 KB, a 200-task page about 550 KB), nothing cacheable so every
reload downloads ~1.1 MB again, Node's default 5 s keep-alive, and a 3.5 MB
source map served publicly. Two server defects ride along: the activity feed
never returns a cursor at `limit=200`, and `listTasks` reads every row after
the cursor before slicing one page.

Built by a single builder on the owner's instruction (HANDOVER.md §4, "one
agent doing all of it"), so it spans `server/src`, `server/web/vite.config.ts`
and one Dockerfile comment.

## Scope — the exact files

- `server/src/http/static.ts`, new `server/src/http/static-cache.ts` — caching
  headers, ETag/304, precompressed brotli/gzip, `*.map` refused
- new `server/src/http/middleware/compression.ts`, `server/src/app.ts` — gzip
  for API JSON, never `text/event-stream` or `/mcp`
- new `server/src/http/keep-alive.ts`, `server/src/index.ts` — keep-alive 65 s
- `server/web/vite.config.ts` — `sourcemap: 'hidden'`
- `docker/Dockerfile` — the "no source maps" comment, if wrong
- `server/src/db/activity.ts` — the `limit + 1` clamp; the project feed's index
- `server/src/services/tasks.ts` — `LIMIT` in SQL for `listTasks`
- `server/src/db/schema.ts` and one generated migration — `heartbeats(created_at)`
- tests under `server/test/` mirroring each of the above

## Acceptance criteria

- [x] Hashed `/assets/*` answer `Cache-Control: public, max-age=31536000, immutable`;
      `index.html` and the SPA document answer `no-cache` with a strong `ETag`
      and `304` on `If-None-Match`; non-hashed public files answer `no-cache`
      with an `ETag`; the build-less fallback keeps `no-store`.
- [x] Static text assets are compressed once per file version (brotli and gzip,
      node:zlib) and served by `Accept-Encoding` with `Content-Encoding` and
      `Vary: Accept-Encoding`; woff2 and images are never compressed.
- [x] API JSON above 1 KB is gzipped; `text/event-stream` (`/api/v1/events`),
      `/mcp` responses and already-encoded responses are not. Each is a test.
- [x] HEAD, `304` and a `Range` request still answer correctly with compression on.
- [x] The HTTP server's `keepAliveTimeout` is 65 s and `headersTimeout` above it,
      proved against the built server.
- [x] `*.map` answers `404` and the built bundle carries no `sourceMappingURL`.
- [x] `activity?limit=200` returns `next_cursor` when more than 200 rows exist,
      for the project and the org feed; the regression test fails on 1f06924.
- [x] `listTasks` pushes `LIMIT limit+1` into SQL when no `ready` filter applies,
      and pages in bounded batches when one does; a test proves every query shape
      answers exactly what the unbounded list answers, over every cursor.
- [x] One migration adds `heartbeats(created_at)` and nothing else; the project
      activity feed's plan uses `activity_project_created_at_idx`; both shown with
      `EXPLAIN QUERY PLAN` before and after.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 after the last edit.

## Notes / context

- No new dependency: `hono/compress` ships with hono 4.13.3; node:zlib is built in.
- Out of scope (later phases): client cache or store, web data-fetching changes,
  `?fields=`, ETags on API JSON, CloudFront or any infrastructure.
- Nothing is pushed from this branch; the owner releases it.
