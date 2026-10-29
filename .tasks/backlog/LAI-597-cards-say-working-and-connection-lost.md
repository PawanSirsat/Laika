---
id: LAI-597
title: 'Cards and the drawer say Working and Connection lost, from the task read’s live claim'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-568]
discovered-from: LAI-568
status: backlog
---

Filed by Belka (polly dispatch, CHIEF's block) while taking LAI-568 over from
Strelka, 2026-10-29.

## Why

LAI-543 shipped only the states the server served then: *Waiting for agent*
and the claim **history** from activity. Its *Working* and *Connection lost*
states were left undelivered because no read carried the live claim.

LAI-568 (PR #112) serves it: `claim` on `TaskView` / `TaskSummaryView` — the
task's `active` or `paused` claim with `session_id`, `last_heartbeat_at`,
`connection` (`live` | `suspect`, as of the read), `suspect_after_ms` and
`device_label`, or `null`. Heartbeats write no activity, so nothing re-reads
the task when a session goes quiet; the client moves `live` to `suspect` on its
own clock from `suspect_after_ms`.

PR #112 also carries the **type mirror** — `TaskLiveClaim` and `claim?` on
`TaskSummary` in `server/web/src/api/tasks.ts` — because the drift check
(`view-type-drift.test.ts`) refused the server half alone. Nothing reads it
yet. This task is the screens.

## Scope

- `cardExecutionState` (`server/web/src/components/agent/execution-derive.ts`)
  returns *Working* for a task with a live `claim` whose heartbeat is younger
  than `suspect_after_ms`, and *Connection lost* once it is not (or once the
  served `connection` is already `suspect`), on the client's clock — a card
  left open goes from one to the other without a re-read.
- The drawer's `ExecutionPanel` fills *Working session* (`session_id`,
  `device_label`) and *Last seen* (`last_heartbeat_at`) from `claim`.
- `claim` null or absent falls back to today's behaviour (*Waiting for agent*
  / history), unchanged.
- Both themes.

## Out of scope

- The session line's harness / model (LAI-593, server; LAI-587, client).
- Any server change.

## Acceptance criteria

- [ ] `execution-derive` unit tests: live claim → Working; heartbeat at
      exactly `suspect_after_ms` → Connection lost; served `suspect` →
      Connection lost; `claim: null` and a view without `claim` → the
      pre-LAI-568 answer.
- [ ] A card held open past `suspect_after_ms` changes from Working to
      Connection lost with no request (browser test, injected clock).
- [ ] The drawer shows the holding session and its last heartbeat from `claim`.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
