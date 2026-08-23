---
id: LAI-006
title: API conventions — pagination, updated_since, errors, idempotency, rate limits
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-002, LAI-004]
discovered-from:
status: in-progress
started: 2026-08-24T04:32:33+05:30
---

## Goal

Implement SPEC §6.3 once, as shared helpers, so that every list and write
endpoint built afterwards behaves identically and nobody reinvents cursors.

## Acceptance criteria

- [ ] Cursor pagination helper: `?limit=` (default 50, max 200) and `?cursor=`
      encoding `(sort_key, id)` opaquely; responses shaped
      `{ "data": [...], "next_cursor": ... | null }`. Stable under inserts.
- [ ] `?updated_since=<unix-ms>` helper usable by any list endpoint, returning
      changed rows **and** tombstones `{ "id": "...", "deleted": true }` for
      soft-deleted records.
- [ ] Zod validation helpers for params, query and body; unknown body fields are
      rejected (`unprocessable`), not silently dropped.
- [ ] Error codes from SPEC §6.3 (`bad_request`, `unauthorized`, `forbidden`,
      `not_found`, `conflict`, `unprocessable`, `rate_limited`, `internal`) with
      correct HTTP statuses, emitted by a single error mapper.
- [ ] `Idempotency-Key` support on POST: same key + same actor within 24h returns
      the stored original response; different body with same key is `conflict`.
- [ ] In-process token-bucket rate limiter keyed by actor/token: 600 req/min
      general, 60/min writes, 30/min heartbeats; `429` with `Retry-After`.
- [ ] Structured JSON request logging: `request_id`, `actor_id`, `token_id`,
      method, path, status, duration; `request_id` returned on 5xx responses.
- [ ] Tests for each helper, including a cursor walk that sees every row exactly
      once while rows are being inserted.

## Notes / context

Milestone: **M1**. SPEC §6.3, §13.2.

`updated_since` is not a nicety — it is how agents and reconnecting SSE clients
catch up (SPEC §11.5). Build it now or every list endpoint gets retrofitted.

Dependencies this task may add: `zod`. Rate limiting and idempotency storage are
in-process/SQLite — no Redis (DECISIONS D-002).
