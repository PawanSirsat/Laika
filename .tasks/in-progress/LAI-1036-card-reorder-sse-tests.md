---
id: LAI-1036
title: 'Card reorder reconciles over SSE, and a second viewer sees it (tests, LAI-473 follow-up)'
area: shell
assignee: shell/belka
priority: p3
depends-on: [LAI-473]
discovered-from: LAI-473
status: in-progress
started: 2026-11-01T16:24:25Z
---

## Why

LAI-473's two stream criteria (a reorder reconciles with its SSE echo; a
second viewer sees the reorder) were accepted unticked, on the claim that
the browser harness serves no event stream. It does: `fakeStream`
(`server/web/test/browser/harness.ts`, LAI-707) replaces `EventSource` and
lets a test emit the frame the server would send.

The tests were written on PR #95 (branch
`LAI-473-followup-reorder-sse-tests`) while CHIEF's id block was full, so
they had no task file. This is it. Board card: LAIKA-892.

## Scope

`server/web/test/browser/card-reorder.test.ts` only. No product code.

## Acceptance criteria

- [ ] A `task.updated` echo for the moved card, arriving while the reorder
      write is held, does not snap the card back; the lane reads the new
      order before and after the answer, with exactly one re-read.
- [ ] A frame about another card, during a held cross-lane drop, does not
      pull the dropped card back to its old lane.
- [ ] Another viewer's change during the drop lands beside the dropped card.
- [ ] A second viewer sees the reorder over SSE without a reload.
- [ ] The file is green on current `master`, run on its own.

## Notes

Frames are hand-emitted through `window.__laikaStream.emit`, so these prove
what the client does with a `task.updated` frame. That the server writes
the row is `server/test/services/tasks.test.ts`'s job.
