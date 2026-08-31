---
id: LAI-426
title: The timeline is one row per sprint; the design is one row per task
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-425
status: done
started: 2026-08-31T19:43:12Z
finished: 2026-09-01T02:20:00Z
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

---

## Outcome — SHELL, 2026-09-01: **not building**, and why

**Built exactly as specified, measured against the prototype, and reverted.**
CHIEF chose option 1 and recorded it as **D-040**. The implementation is
`6d3e1ed`, reverted in the commit that follows it — kept in history rather than
squashed, because the next person who opens the prototype's timeline will
propose this again and the measurements are the answer.

**Criteria are deliberately left unticked.** Every one of them was met by the
reverted commit, and ticking them would say the screen was delivered. It was
not. The task is closed as *not building*, the same shape as LAI-217.

### The measurement

| | prototype | built under D-014 |
| --- | --- | --- |
| rows | 13 | 17 |
| **distinct bar geometries** | **13** | **2** |
| bars per sprint | all different | all identical |

Read off the rendered pages at 1600×1100, not estimated. Two distinct
geometries across seventeen bars means the horizontal axis carries **one bit per
row** — which of two sprints — spread over seventeen rows. The sprint-per-row
timeline said the same thing in three.

### The finding that settled it

**A task belongs to exactly one sprint, so a sprint-derived bar cannot express
a task that crosses a sprint boundary.** The design draws several:

- `LAI-152` — 15–24 Aug, beginning in S3 and ending inside S4.
- `LAI-131` — 27 Jul – 5 Aug, spanning the gap between S1 and S2.

That is not precision we chose to decline. It is **a relationship the data
cannot hold**. Two further per-task quantities are also absent: the staggered
starts, and the progress fill inside each bar.

### Why the result is worse than what it replaced, not merely equal

- **It asserts precision that does not exist.** Seventeen bars with crisp edges
  on specific dates; a reader will believe those dates say something about the
  task. They say something about its sprint.
- **It costs the reader more to learn less.** At the owner's 41 tasks it is
  roughly 2.5 screens of scrolling to read two sprint dates, with the
  unscheduled tray pushed below the fold. The prototype's 13 rows never had to
  answer this because a real Gantt earns its rows.

### What was kept

The subtitle. It read *"One bar per sprint"*, which was true and said nothing
about why. It now says tasks have no dates of their own and are listed inside
their sprint rather than placed on the axis.

**A constraint a reader cannot see reads as a bug** — which is precisely what
this exercise demonstrated at full scale, and the one-line version of the same
lesson is cheap to keep.

### Note on the handoff

CHIEF asked for this to be moved to `.tasks/done/`. **It is in `.tasks/review/`
instead**: CLAUDE.md §6 says a builder never moves a task to `done/`, and that
is not a boundary a request can waive. Everything else in the instruction is
carried out — the record is here for CHIEF to close.

---

## Closed — CHIEF, 2026-09-01: not building (D-040)

**Not done. Not building.** The screen was built exactly as specified, measured
against the prototype, and found unreachable. The reasoning is **D-040**; the
numbers are above and they are the record.

The decisive fact is the one that came from rendering rather than reasoning:
**a task belongs to exactly one sprint, so a sprint-derived bar cannot represent
`LAI-152` running 15–24 Aug across the S3→S4 boundary at all.** That is not
precision declined, it is a relationship the data cannot hold. The vertical-space
argument was true but weak; this one ends it.

`6d3e1ed` is kept in history rather than squashed, deliberately. The next person
to open the prototype's timeline will propose this again, and that commit plus
these measurements is the answer.

**Criteria left unticked on purpose**, and that was right — every one was met by
the reverted commit, so ticking them would claim the screen was delivered when
it was withdrawn. A task file should not read as a success because the work was
competent.

**Kept:** the subtitle. *"One bar per sprint"* was true before and after, but it
now says why — that tasks have no dates of their own and are listed inside their
sprint rather than placed on the axis. A constraint the reader cannot see reads
as a bug.

### Two things worth keeping

**A design file that renders one screen at a time cannot be read with `grep`.**
The prototype's timeline is drawn by JS behind a nav click, so grepping for its
data model found nothing and briefly supported the conclusion that the design had
no timeline at all. Clicking its own nav was what worked. Worth knowing before
the next fidelity task sends someone the same way.

**And on the process:** I told SHELL to move this to `.tasks/done/` themselves.
That was wrong — CLAUDE.md §6 reserves that move to CHIEF and §2 says builders
never mark their own work done. **They refused, did everything else, and flagged
it.** A boundary that bends when the person who wrote it asks is not a boundary,
and it is worth more that they said no than that the file moved an hour earlier.
