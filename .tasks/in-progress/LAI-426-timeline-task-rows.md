---
id: LAI-426
title: The timeline is one row per sprint; the design is one row per task
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-425
status: in-progress
started: 2026-08-31T19:43:12Z
---

## Goal

**The owner's instruction, verbatim: match the design for what we already have
functionally, and do not match what we do not have.** This task is the timeline
half of that, and the line falls in an unusual place — the *shape* is backable
and the *dates* are not.

| | `Laika Prototype.dc.html` | shipped |
| --- | --- | --- |
| rows | **one per task**, in a left `TASK` column | one per **sprint** |
| left column | avatar, title, key, status, date range | — |
| columns | month bands **and** sprint columns with name, count, range | month bands only |
| bars | one per task, spanning that task's **own** dates | one per sprint |
| today | `TODAY · TUE 18 AUG` label on a vertical rule | a marker |
| below | — | an Unscheduled tray |

## What is backable, and what is not

**Backable, because the data exists today:**

- One row per task, with the assignee avatar, title, `LAI-nn` key and status.
- Sprint **columns** across the top carrying name, `done/total` and date range —
  `GET /projects/:slug/sprints` returns all of it.
- Month bands and the `TODAY` rule.
- Status colour per bar: done / in progress / review / blocked.

**Not backable, and must not be invented:**

- **A bar spanning a task's own dates.** `LAI-131 DONE 27 Jul – 5 Aug` in the
  design is a per-task range, and **D-014 is explicit: "the timeline is
  sprint-based; tasks never get dates"** — *"draw it from sprint boundaries and
  it costs a view; draw it from task dates and it costs a scheduling engine."*
  There is no `starts_on` on a task and there must not be one.

**So: a task's bar spans the range of the sprint it is in.** Every task in a
sprint gets the same horizontal extent, and they differ by status colour and by
row. That is honest — it shows which sprint holds each task, which is the real
relationship — and it is the only reading D-014 permits.

**If that looks wrong once built, stop and say so rather than reaching for dates.**
It is a legitimate outcome that the design's timeline needs a capability this
product has deliberately refused, and the answer would be a decision from the
owner, not a schema change made from the UI.

## Acceptance criteria

- [ ] One row per task, ordered by sprint then by the board's own order, with
      avatar, title, key and status in a fixed left column that does not scroll
      horizontally with the bars.
- [ ] Sprint columns across the head, each with name, `done/total` and its date
      range — read from the sprints endpoint, never derived from task counts.
- [ ] Each task's bar spans **its sprint's** range. A task with no sprint has no
      bar and stays in the unscheduled list.
- [ ] Bars carry status colour using **existing tokens only**. No new colour;
      if none fits, stop and file (D-020).
- [ ] The `TODAY` rule is labelled, as in the design, and only drawn when today
      falls inside the rendered range.
- [ ] The unscheduled tray survives — it is ours, it is useful, and the design
      not having one is not a reason to drop it.
- [ ] Empty and single-sprint cases still render: no sprints at all keeps the
      current empty state.
- [ ] Both themes, in a real browser, compared against the prototype at the same
      viewport. Full gate green.

## Notes

No new dependencies, no new tokens, no schema change, and **no task dates** —
that last one is the whole point of the task.

`useSprints` already walks both sprints and tasks, so the data is in hand; this
is a rendering change, not a data one.
