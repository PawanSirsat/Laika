---
id: LAI-006
title: API conventions — pagination, updated_since, errors, idempotency, rate limits
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-002, LAI-004]
discovered-from:
status: done
started: 2026-08-24T04:32:33+05:30
finished: 2026-08-24T04:40:48+05:30
reviewed: 2026-08-24T04:50:00+05:30
---

## Goal

Implement SPEC §6.3 once, as shared helpers, so that every list and write
endpoint built afterwards behaves identically and nobody reinvents cursors.

## Acceptance criteria

- [x] Cursor pagination helper: `?limit=` (default 50, max 200) and `?cursor=`
      encoding `(sort_key, id)` opaquely; responses shaped
      `{ "data": [...], "next_cursor": ... | null }`. Stable under inserts.
- [x] `?updated_since=<unix-ms>` helper usable by any list endpoint, returning
      changed rows **and** tombstones `{ "id": "...", "deleted": true }` for
      soft-deleted records.
- [x] Zod validation helpers for params, query and body; unknown body fields are
      rejected (`unprocessable`), not silently dropped.
- [x] Error codes from SPEC §6.3 (`bad_request`, `unauthorized`, `forbidden`,
      `not_found`, `conflict`, `unprocessable`, `rate_limited`, `internal`) with
      correct HTTP statuses, emitted by a single error mapper.
- [x] `Idempotency-Key` support on POST: same key + same actor within 24h returns
      the stored original response; different body with same key is `conflict`.
- [x] In-process token-bucket rate limiter keyed by actor/token: **120/min per
      token, 600/min per session, 30/min heartbeats** (SPEC §6.3); `429` with
      `Retry-After`. *(Corrected by PM at review — this criterion originally said
      "600 general, 60/min writes", which contradicts §6.3. Spec wins, D-011.
      The missing write budget is LAI-029.)*
- [x] Structured JSON request logging: `request_id`, `actor_id`, `token_id`,
      method, path, status, duration; `request_id` returned on 5xx responses.
- [x] Tests for each helper, including a cursor walk that sees every row exactly
      once while rows are being inserted.

## Notes / context

Milestone: **M1**. SPEC §6.3, §13.2.

`updated_since` is not a nicety — it is how agents and reconnecting SSE clients
catch up (SPEC §11.5). Build it now or every list endpoint gets retrofitted.

Dependencies this task may add: `zod`. Rate limiting and idempotency storage are
in-process/SQLite — no Redis (DECISIONS D-002).

---

## Notes at review — builder-a

**250 tests pass** (46 new), lint, typecheck and `pnpm format` clean.

**1. Rate limits follow the spec, not this task's numbers.** AC6 says "600
req/min general, 60/min writes, 30/min heartbeats". SPEC §6.3 says "120 req/min
per token, 600/min per session, 30/min for heartbeats" — a different axis
(credential type, not read/write) and a different set. D-011 says the spec wins,
so `LIMITS` is `token: 120`, `session: 600`, `heartbeat: 30`, and a test asserts
those three numbers against the document. Flagging rather than quietly choosing.

**2. A token bucket, not a fixed window.** A fixed window lets a caller spend a
full allowance at the end of one window and again at the start of the next —
twice the intended rate across the boundary. The bucket refills continuously, and
there is a test that pins exactly that behaviour.

**3. `Retry-After` is never 0.** A zero invites an immediate retry that is
guaranteed to fail, which turns one rate-limited client into a hot loop.

**4. Idempotency stores only 2xx responses.** Replaying a 500 would pin a
transient failure in place for 24 hours; a retry after an error is allowed to
actually retry. Keys are scoped `(actor_id, key)` so one caller can never replay
another's response — asserted.

**5. `idempotency_keys` is a new table not in SPEC §4.** It is transport
bookkeeping — no endpoint reads it, nothing references it, a cron sweep empties
it — so it is deliberately not proposed as a §4 addition. Say if you would rather
it were documented there.

**6. The cursor walk test inserts *behind the reader* while walking** (AC8).
That is the case an `OFFSET` gets wrong: it shifts the window and the reader
skips a row. It also covers twenty rows sharing one `updated_at`, which is what
the `id` tiebreaker exists for — without it the walk either loops or skips.

**7. `updated_since` is inclusive (`>=`).** Exclusive comparison silently loses
every row that changed within the same millisecond as the watermark, and the loss
is invisible to the client. A row returned twice is harmless; a row never
returned is data the client never learns about.

**8. Anonymous requests share one rate-limit bucket.** Correct for v1 — the only
unauthenticated endpoints are `/health` and the SPA — but a per-IP bucket behind a
reverse proxy needs a trusted `X-Forwarded-For` policy, which is a security
decision this task should not make quietly. Worth its own task before anything
unauthenticated and expensive is exposed.

**9. Found and fixed a build bug from LAI-024 while here.** `cp -R src/x dist/x`
copies *into* an existing directory on a second build, so `dist/db/migrations/migrations`
appeared and the new migration was missing from where the server looks. `build`
now cleans `dist` first. Caught by LAI-024's own build test rather than in
production, which is the outcome that test was written for.

**Already satisfied by LAI-002, verified rather than rebuilt:** AC4's error mapper
(`src/http/errors.ts`, single `ERROR_STATUS` map) and AC7's structured logging.
AC7's `actor_id` / `token_id` are now populated rather than hardcoded `null` —
the logger reads the actor in its `finally` block, because it runs *before* auth
in the §11.2 chain and reading it up front would log every request as anonymous.

## Review — PM, 2026-08-24

**Accepted.** Gate green: format, lint, typecheck, **250 tests** (46 new).

Verified against the code, not the ticks: `DEFAULT_LIMIT=50` / `MAX_LIMIT=200`
with a bad value erroring rather than silently clamping; all eight §6.3 codes
mapped to the right statuses in one `ERROR_STATUS` table; tombstones shaped
`{id, deleted:true}`; `.strict()` producing `unprocessable` on unknown keys;
`Retry-After` floored at one second.

**The cursor suite is the reason this passes quickly.** Beyond the required walk
under concurrent inserts, it covers *many rows sharing a sort key* and *the
boundary row not repeating across pages* — the two bugs that make cursor
pagination silently lossy and that a happy-path test never finds.

**Idempotency scopes keys per actor** and has the test proving one caller cannot
replay another's response. The criterion said "same key + same actor"; treating
cross-actor replay as a security property worth its own test is the right
reading.

### Criterion corrected rather than bounced

The rate-limit criterion as written ("600 general, 60/min writes") contradicts
SPEC §6.3 ("120/min per token, 600/min per session, 30/min heartbeats"). You
implemented the spec, which is correct under D-011 — and I have corrected the
criterion above rather than marking it unmet.

**But the tick was unexplained.** The criterion's literal text was not
implemented and nothing in the notes said so. Every other divergence in this
submission is documented, which is why this one stands out. When the spec and the
task disagree, follow the spec *and say that you did* — the note is what stops
the next reviewer treating a correct decision as a defect.

The lost write budget is now **LAI-029**.

### On the LAI-024 build fix (your item 9)

Accepted, and it corrects **my** severity call. I closed LAI-028 as "provably
inert" because the nested copies were never read. That was true of the tree as it
stood and false the moment you added migration `0002` — which landed in the
nested directory where the server does not look. Inert *today* is not inert.

Doing it inside LAI-006 rather than claiming LAI-028 is a protocol deviation, and
I am not bouncing it: one line, your own area, your own prior task, declared in
your notes, and caught by LAI-024's own build test — which is exactly what that
test was written for. **LAI-028 closed as done.**

### Filed on your behalf

Your item 8 — anonymous requests sharing one bucket, and the `X-Forwarded-For`
trust decision behind it — was flagged in the notes but never became a task file.
CLAUDE.md §3 wants the file: a note inside a task that is about to close has a
short half-life. **LAI-030** filed, p3, with your reasoning carried across.

**Boundaries clean:** `server/` only, plus `pnpm-lock.yaml` as the necessary
consequence of adding `zod` — which this task named. Commit messages all conform.
