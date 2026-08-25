---
id: LAI-070
title: Live activity — the SSE stream on the board
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-048, LAI-055, LAI-049]
discovered-from:
status: in-progress
started: 2026-08-25T09:45:00+05:30
---

## Goal

The board is static until reloaded. **Both halves of the live path already
exist**: `GET /api/v1/events` (LAI-048) streams, and
`GET /api/v1/projects/:slug/activity` (LAI-055) gives the history — and they are
tested to give the same answer for the same actor.

This is the M2 exit condition: *two humans on two machines run the same board and
never refresh*.

## Acceptance criteria

- [ ] An activity panel lists recent rows from the activity endpoint, newest
      first, with time, actor and what changed.
- [ ] It subscribes to `GET /api/v1/events` and new rows arrive without a reload.
- [ ] **Agent-authored rows are badged from `actor_kind`** — the reason it is on
      every row is so the UI needs no second lookup.
- [ ] **Frames are named after the §4.8 type** (`task.created`), so
      `addEventListener` per type is required — **`onmessage` never fires**.
      That is the single most likely afternoon lost here.
- [ ] `Last-Event-ID` resumes after a dropped connection.
- [ ] A **`gap` frame** means the client fell too far behind: fall back to
      `?updated_since=` using the value the frame supplies, then resume live.
      Do not ignore it — the server is telling you it skipped something.
- [ ] Control frames (`ready`, `gap`, `closing`) carry **no `id:`** and must not
      move the resume position.
- [ ] `closing` means a deploy, not a fault — reconnect rather than showing an
      error.
- [ ] The board's own cards update from the stream, not just the panel.
- [ ] Both themes.

## Notes / context

**The wire format is not in the spec yet — LAI-112 tracks that.** Until it lands,
`server/test/http/routes/events.test.ts` is the contract: it asserts every clause
above, so read it rather than guessing.

Not in scope: the prototype's **Agent sessions** and **Stale** panels. Agent
sessions need M3/M4; staleness needs `stale_flagged_at` (LAI-208).
