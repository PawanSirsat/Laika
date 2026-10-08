---
id: LAI-722
title: 'Performance phase 1 — cache, compress and keep alive what the server sends; fix activity paging; LIMIT the task list'
area: server
assignee: owner-direct
priority: p1
depends-on: []
status: done
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
- `server/web/test/source-maps.test.ts` — the bundle names no source map
  (added to this list in review round 1)
- `logs/perf-2026-10-08.md` — this task's log (added in review round 1)

## Acceptance criteria

- [x] Hashed `/assets/*` answer `Cache-Control: public, max-age=31536000, immutable`;
      `index.html` and the SPA document answer `no-cache` with a strong `ETag`
      and `304` on `If-None-Match`; non-hashed public files answer `no-cache`
      with an `ETag`; the build-less fallback keeps `no-store`.
- [x] Static text assets are compressed once per file version (brotli and gzip,
      node:zlib) and served by `Accept-Encoding` with `Content-Encoding` and
      `Vary: Accept-Encoding`; raster images and fonts are never compressed
      (SVG and ICO, being text, are — reworded in review round 1).
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

## Review notes (round 1)

Approved, no blockers. The **orchestrator** (polly) ran the full gate on
14910f9: TEST 0, LINT 0, FMT 0, which verifies criterion 10. Follow-ups, each
a new commit. (Corrected in place: this first said the reviewer ran that gate.)

1. Scope list was missing `server/web/test/source-maps.test.ts` and
   `logs/perf-2026-10-08.md` — added above.
2. EXPLAIN QUERY PLAN before and after (project, task and org feed, presence,
   capacity) recorded in `logs/perf-2026-10-08.md`.
3. The compression floor applied only to `application/json`; a 5-byte
   `text/plain` or `application/problem+json` body was gzipped to ~25 bytes.
   Now every `json`/`text/*` body that is not an event stream is measured; tested.
4. The `/api/v1/events` path skip was never tested on its own (hono/compress
   also refuses `text/event-stream`); a bare-Hono test now fails on its removal.
5. The static cache is warmed at boot, fire-and-forget, failures logged; tested.
6. AC2 said "images" are never compressed, but SVG and ICO are — correctly.
   The criterion is reworded to "raster images and fonts".
   **Process note:** AC2 was reworded while the task was in review, which
   CLAUDE.md §2 otherwise freezes. It only narrows the wording to match the
   correct behaviour, at the reviewer's suggestion, and the reviewer has
   acknowledged it.
7. The keep-alive comment claimed a current Node race; reworded as defensive.
   `headersTimeout` is now proven against the built server too.
8. LAI-723 raised to p1 with the reviewer's numbers.
9. Optional, done: a `304` answers only the ETag of the representation served.

## Review notes (round 2)

Re-review: approved. The **reviewer** ran the gate on 7c1412e in a scratch
archive: TEST 0, LINT 0, FMT 0, with two git-dependent server tests skipped
(no `.git` in an archive). Two corrections, one commit:

1. The gate attribution above, fixed in place here and by a correction entry
   in the append-only log.
2. `compression.ts`: "a stream is never buffered" over-claimed — only the event
   stream is excluded. Reworded: no other `/api/` route streams today, and a
   future streaming route must set `Content-Length` or be excluded there.


## Accepted

2026-10-08, by polly (orchestrator), on the owner's instruction to release.
Independent review: APPROVE after round 1 (same-vendor Claude reviewer). The
AC2 rewording made while in review only narrows wording to correct behaviour
and is acknowledged here. Released at build-perf-delivery `e771230`. LAI-723
(p1) is the client-side follow-up and is not part of this release.
