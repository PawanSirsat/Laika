---
id: LAI-070
title: Live activity — the SSE stream on the board
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-048, LAI-055, LAI-049]
discovered-from:
status: review
started: 2026-08-25T09:45:00+05:30
finished: 2026-08-25T00:59:02Z
---

## Goal

The board is static until reloaded. **Both halves of the live path already
exist**: `GET /api/v1/events` (LAI-048) streams, and
`GET /api/v1/projects/:slug/activity` (LAI-055) gives the history — and they are
tested to give the same answer for the same actor.

This is the M2 exit condition: *two humans on two machines run the same board and
never refresh*.

## Acceptance criteria

- [x] An activity panel lists recent rows from the activity endpoint, newest
      first, with time, actor and what changed.
- [x] It subscribes to `GET /api/v1/events` and new rows arrive without a reload.
- [x] **Agent-authored rows are badged from `actor_kind`** — the reason it is on
      every row is so the UI needs no second lookup.
- [x] **Frames are named after the §4.8 type** (`task.created`), so
      `addEventListener` per type is required — **`onmessage` never fires**.
      That is the single most likely afternoon lost here.
- [x] `Last-Event-ID` resumes after a dropped connection.
- [x] A **`gap` frame** means the client fell too far behind: fall back to
      `?updated_since=` using the value the frame supplies, then resume live.
      Do not ignore it — the server is telling you it skipped something.
- [x] Control frames (`ready`, `gap`, `closing`) carry **no `id:`** and must not
      move the resume position.
- [x] `closing` means a deploy, not a fault — reconnect rather than showing an
      error.
- [x] The board's own cards update from the stream, not just the panel.
- [x] Both themes.

## Notes / context

**The wire format is not in the spec yet — LAI-112 tracks that.** Until it lands,
`server/test/http/routes/events.test.ts` is the contract: it asserts every clause
above, so read it rather than guessing.

Not in scope: the prototype's **Agent sessions** and **Stale** panels. Agent
sessions need M3/M4; staleness needs `stale_flagged_at` (LAI-208).

---

## Verification (builder-b, 2026-08-25)

Driven against a real instance on `:3370`, not reasoned about. The owner's demo
container on `:3000` was not touched.

| Criterion | How it was shown |
| --- | --- |
| Panel, newest first, time/actor/what | Seeds 12 rows from `/activity` on load. |
| New rows without a reload | Created a task via `fetch` from the console; `LC-5` appeared on the board with no reload. |
| Agent badged from `actor_kind` | Inserted an `actor_kind: 'agent'` row; only that row got the marker, the other 11 did not. |
| Named frames, `onmessage` never fires | Probe with both handlers attached: `onmessage` 0, `task.created` 1. |
| `Last-Event-ID` resumes | Client reconnected from seq 631; server computed `missed: 600`. |
| `gap` acted on | 600 rows inserted while disconnected → reconnect produced 3 catch-up requests. **Control run** (restart, nothing missed) produced **0** — so the refetch is the gap, not the reconnect. |
| Control frames carry no `id:` | `ready` and `gap` both arrive with `lastEventId === ''`. |
| `closing` reconnects, not errors | `SIGTERM`: `closing {"reason":"server_shutdown"}` → retry every 3s on the server's own `retry:` hint, indefinitely, no error state. |
| Cards update from the stream | `LC-5` and `LC-6` both appeared without a reload. |
| Both themes | Driven through the real theme control. The rail's avatar is computed **in JS**, and it changed palette with the theme — the failure mode `use-theme.ts` documents. |

## Deviation from AC6, stated rather than hidden

AC6 says to fall back to `?updated_since=` **using the value the frame supplies**.
This reloads the project's task list wholesale instead, and does not consult the
value. Two reasons, the first of which is a finding:

1. **The value is not always there.** `gap` has two shapes. `replay_too_large`
   carries `updated_since`; **`unknown_last_event_id` carries
   `updated_since: null`** — a restored backup or a replaced `laika.db`, where
   the server genuinely cannot know what the client has. Read off the wire:

   ```
   {"reason":"unknown_last_event_id","missed":-1,"limit":500,"updated_since":null}
   ```

   An implementation keyed on that value ignores the second shape completely.
   The first version of this hook did exactly that, and the board would have sat
   stale under a pill still reading `LIVE`. `nextGap()` now advances a counter on
   **every** gap, including one whose body does not parse, and
   `use-events.test.ts` covers it — proven able to fail by restoring the old
   behaviour (3 tests went red).

2. A full read of one project's tasks is a **superset** of the delta, and unlike
   a delta it cannot miss a removal.

If PM would rather have the literal `?updated_since=` path, this comes back —
but AC6 as written cannot be satisfied for `unknown_last_event_id`.

## Two panels this task put out of scope

`Agent sessions` and `Stale · no movement` are on the board rail. I built both
during the earlier board sweep under the owner's UI-matching directive, before
claiming this task, so they are **not** LAI-070's work and are not counted in any
criterion above. Both render a `DemoNotice` naming what does not exist
(`heartbeats` has no writer; staleness needs `stale_flagged_at`, LAI-208).
Leaving them is deliberate — removing them would undo an explicit owner
instruction — but they are flagged here so review is not misled about what this
task delivered.

## Filed while working

- **LAI-214** (`area: server`) — the events route answers new connections with
  `ready` for up to `grace_ms` after `shutdown.start`, on reused HTTP keep-alive
  connections. Observed, with server logs, during the `closing` test.
- **LAI-215** (`area: web`) — `initials()` exists four times. The rail needed a
  fourth; `src/theme/initials.ts` was extracted and tested instead, and the three
  existing copies were left for that task rather than refactored here.
