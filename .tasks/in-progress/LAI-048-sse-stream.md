---
id: LAI-048
title: SSE stream — GET /api/v1/events
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011]
discovered-from:
status: in-progress
started: 2026-08-24T09:33:17+05:30
---

## Goal

The live half of the board (D-003). One `text/event-stream` per client, emitting
`activity` rows the actor is allowed to see, with gap recovery.

## Acceptance criteria

- [ ] `GET /api/v1/events` returns `text/event-stream`, `?project=` optional.
- [ ] **Filtered server-side** to the projects the actor may see. A Viewer on one
      project must not receive another project's events — tested by connecting as
      a member of A and asserting silence while B is written to.
- [ ] Each event carries a **monotonic id**; the client's `Last-Event-ID` on
      reconnect replays what it missed.
- [ ] When the gap is too large to replay, the stream says so rather than
      silently skipping — the client then falls back to `?updated_since=`
      (§6.3, §11.5). Define "too large" and state the number in the code.
- [ ] A comment frame every **25 seconds** so proxies do not close an idle
      stream.
- [ ] Disconnect is clean: no leaked timer, no listener left on the emitter after
      the client goes away. Assert it — a stream that leaks per connection is a
      slow crash, not a bug.
- [ ] Graceful shutdown (LAI-002) closes open streams rather than dropping them.

## Notes / context

SPEC §11.5, §6.4, D-003. The `activity` table is the only source (§4.8) — the
stream reads it, nothing publishes to the stream directly. That is what keeps SSE
consistent with what a page reload would show.

**`actor_kind` is on every row** (§4.8), so agent-authored events arrive already
distinguishable — the UI needs no second lookup to badge them.

**The leak test is the one that matters.** Everything else fails loudly in
development; a listener that outlives its connection only shows up as a server
that dies after a week.

No new dependencies — Hono streams natively; do not add an SSE library.
