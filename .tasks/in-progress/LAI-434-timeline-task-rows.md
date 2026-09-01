---
id: LAI-434
title: 'The Timeline gets task rows on the axis, drawn from real dates (D-049)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-126, LAI-121]
discovered-from:
status: in-progress
started: 2026-09-01T05:49:43Z
---

## Goal

**The owner looked at the prototype's Timeline beside ours and said the
prototype's is what they want.** D-040 said it was unreachable; **D-049
overturns it**, because LAI-126 landed today and `TaskView` now carries
`started_at` and `completed_at`.

Read **D-049 first.** It says which pixel comes from which field and what is
still not being built.

Today's screen is one bar per sprint plus a list. The target is **one row per
task**, positioned on a day-scaled date axis, with the sprint bands behind it.

## What comes from where — this is the whole design

| Task state | Bar | Source |
| --- | --- | --- |
| `done` | **solid**, start to finish | `started_at → completed_at` — actual |
| `in_progress` | **solid** to today, then a **lighter remainder** to the sprint's end | `started_at → now`, remainder from the sprint |
| `todo` / `backlog`, in a sprint | **outlined**, spanning the sprint | the sprint's range — a plan |
| `done` or `in_progress` with a **null** `started_at` | outlined, spanning the sprint | it is a plan, because we do not know when it started |
| no actuals **and** no sprint | the Unscheduled tray, as today | — |

**A solid bar is something that happened. An outline is somewhere a task was
put.** They must be distinguishable at a glance without a legend, in **both
themes**. That is the entire remaining content of D-014 and it is the one thing
in this task that is not cosmetic.

## What each row shows, left to right

Match the prototype (`docs/design/Laika Prototype.dc.html`, Timeline view):

- **assignee avatar** — initials, colour keyed off the user id, as the board
  already does. Reuse it; do not write a fourth `initials()` (LAI-215).
- **title**, truncated with the full text on hover
- **display key** (`LAI-42`), **status chip**, and the **date range the bar
  represents** — and when that range is the sprint's rather than the task's, the
  row must say so rather than presenting a plan as a measurement.
- the **bar**, coloured by status, **red with a blocked marker** when
  `blocked_by` contains an unfinished blocker. `board-derive.ts` already computes
  exactly that — reuse it.

## The axis and the chrome

- **Sprint bands behind the rows**, with the sprint name, range and `done/total`
  in the band header — `timeline-derive.ts` already builds the bands, the month
  header and the today marker. **Keep them.** This task adds a task track; it
  does not rewrite the axis.
- **The today marker stays** and is the reason the axis exists.
- **Sprint tabs across the top** with per-sprint progress, and a summary strip
  for the active sprint: **DONE n/m · BLOCKED n · WIP n · DAYS LEFT n**. All four
  are derivable from tasks + the sprint's end date. **Derive them; do not invent
  one that is nearly right.**

## Acceptance criteria

- [ ] One row per task, positioned on the axis, per the table above.
- [ ] **No bar is drawn from a date the task does not have.** This replaces
      `timeline-derive.test.ts`'s *"D-014 — tasks never get a position on the
      axis"*, which **D-049 retires** — replace it, do not delete it. The new
      test asserts the fallback: null `started_at` ⇒ outlined sprint-derived bar;
      no sprint either ⇒ no bar at all.
- [ ] Solid and outlined bars are distinguishable **in both themes**, and a
      test asserts the two states produce different classes rather than the same
      class with a different colour token — a colour-only difference disappears
      for a colour-blind reader and in a screenshot.
- [ ] The active sprint's **DONE / BLOCKED / WIP / DAYS LEFT** are each derived
      and each tested against a fixture where all four differ. Four counts that
      happen to be equal is a test that cannot fail.
- [ ] **DAYS LEFT is computed against the sprint's end and clamps at zero**, and
      an ended sprint does not show a negative or a wrapped number.
- [ ] The blocked marker uses `board-derive.ts`'s existing computation. **If it
      is not exported, export it — do not reimplement it.**
- [ ] A **browser test** (LAI-227's harness) that a done task renders a solid bar
      and a todo task in the same sprint renders an outlined one, in both themes,
      and that the today marker sits inside the active sprint's band.
- [ ] The Unscheduled tray still works and still counts correctly.
- [ ] Full gate green — **repo-root `pnpm test`** (D-045).

## Notes / context

**No new endpoint and no server dependency.** `GET /projects/:slug/timeline` is
in §6.4 and **does not exist** — I checked the running instance, it is a `404`.
Everything here comes from `GET /projects/:slug/tasks` and
`GET /projects/:slug/sprints`, both of which you already call. **Do not file for
the timeline endpoint under this task**; if the client-side join is genuinely too
slow at 200 tasks, file it and say what you measured.

**No new dependency**, and no charting library. The existing derive module does
percentages against a day-granular axis; a task bar is the same arithmetic with a
different pair of dates.

**Take style from `docs/design/`, not markup** — the prototype is inline-styled
HTML from a foreign runtime. Colours, spacing and type come from
`docs/design/README.md`'s tokens.

**Do not reproduce the prototype's artifacts**: no overlapping labels, no pills
colliding with bars. And its rows carry hand-picked date ranges for `TO DO`
tasks — **those are fixtures**, and reproducing them is the invented-dates
failure D-040 was right about and D-049 does not license.
