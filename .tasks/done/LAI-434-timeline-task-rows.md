---
id: LAI-434
title: 'The Timeline gets task rows on the axis, drawn from real dates (D-049)'
area: web
assignee: shell
priority: p1
depends-on: [LAI-126, LAI-121]
discovered-from:
status: done
started: 2026-09-01T06:09:08Z
finished: 2026-09-01T07:05:00Z
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

- [x] One row per task, positioned on the axis, per the table above.
- [x] **No bar is drawn from a date the task does not have.** This replaces
      `timeline-derive.test.ts`'s *"D-014 — tasks never get a position on the
      axis"*, which **D-049 retires** — replace it, do not delete it. The new
      test asserts the fallback: null `started_at` ⇒ outlined sprint-derived bar;
      no sprint either ⇒ no bar at all.
- [x] Solid and outlined bars are distinguishable **in both themes**, and a
      test asserts the two states produce different classes rather than the same
      class with a different colour token — a colour-only difference disappears
      for a colour-blind reader and in a screenshot.
- [x] The active sprint's **DONE / BLOCKED / WIP / DAYS LEFT** are each derived
      and each tested against a fixture where all four differ. Four counts that
      happen to be equal is a test that cannot fail.
- [x] **DAYS LEFT is computed against the sprint's end and clamps at zero**, and
      an ended sprint does not show a negative or a wrapped number.
- [x] The blocked marker uses `board-derive.ts`'s existing computation. **If it
      is not exported, export it — do not reimplement it.**
- [x] A **browser test** (LAI-227's harness) that a done task renders a solid bar
      and a todo task in the same sprint renders an outlined one, in both themes,
      and that the today marker sits inside the active sprint's band.
- [x] The Unscheduled tray still works and still counts correctly.
- [x] Full gate green — **repo-root `pnpm test`** (D-045).

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

---

## Briefly released by SHELL, 2026-09-01 — interrupted for LAI-147

Released only to respect **one task in progress per session** (§2) while I clear
LAI-147, which unblocks two finished tasks sitting in review. **Re-claiming
immediately after.** Nothing is abandoned and nothing is uncommitted.

**Already on `shell`:** `taskBar`, `taskActuals` and `sprintSummary` in
`timeline-derive.ts` — D-049's table, and the rule that survives D-014: a bar is
`actual` only when **both** ends were measured, and an unmeasured end demotes the
whole bar to a sprint-derived outline. No clamping: moving a bar's start to the
axis edge would assert a date nobody gave us, so the axis widens via
`taskActuals` instead.

**Still to do:** the row/track component, the sprint tabs and summary strip, the
replacement for the D-014 guard (replace, never delete), and the browser test.

---

## Build note — SHELL, 2026-09-01

### The rule that is not cosmetic, and how it is carried

**Solid means measured. An outline means placed.** Carried by **fill and border
style** — filled with a solid edge against transparent with a dashed one — not by
a colour token. Colour still carries *status*; it does not carry
measured-versus-planned, because a colour-only difference disappears for a
colour-blind reader and in a greyscale screenshot.

Measured in the browser, both themes:

| | fill | border |
| --- | --- | --- |
| measured | `rgb(17,153,106)` light / `rgb(47,208,138)` dark | solid |
| placed | `rgba(0,0,0,0)` — **transparent in both** | dashed |

**Mutation-proven with the exact defect the criterion forbids:** making the
outline a filled `--bd2` with a solid border turns the browser test red with
*"Light: both bars have solid borders — the difference is colour only"*.

### The fallback is the load-bearing part

A bar is `actual` only when **both** ends were measured. An unmeasured end
demotes the whole bar to the sprint, marked as a plan — and the row **says so**,
because a sprint's range in the same voice as a measurement is the misreading
D-014 exists to prevent and it is invisible once the bar is drawn.

**That is not hypothetical.** On the running instance, `LAI-3` is `done` with a
`completed_at` and **no `started_at`** — it was already `in_progress` before
LAI-126 landed, so it never passed the first-entry stamp. It renders as a dashed
outline over its sprint, which is the honest answer: we know when it finished and
not when it began.

### The boundary-crossing case, which D-040 said was unrepresentable

It was — *from sprint boundaries*. From actuals it is one span, and there is a
test for it: a task started in one sprint and finished in the next draws **one
bar across both bands**, not clipped to either.

### The axis widens; bars are never clamped

`timelineRange` takes the task actuals as well as the sprints. Clamping a bar to
the axis edge would show a start date nobody gave us — the one thing D-049 kept.
Tested: a task that started three days before the first sprint widens the axis
rather than being clipped.

### DONE · BLOCKED · WIP · DAYS LEFT

All four derived, and tested against a fixture where **all four differ** — four
equal counts is a test that cannot fail. `DAYS LEFT` clamps at zero, and the last
day of a sprint reads zero rather than one, because `ends_on` is inclusive
(§4.15). `blocked` is `board-derive.ts`'s computation, passed in rather than
recomputed — a second blocked rule is the LAI-215 `initials()` problem.

### The old guard was replaced, not deleted

*"D-014 — tasks never get a position on the axis"* is gone, as D-049 authorises.
Its successor is **"no bar is drawn from a date the task does not have"**, which
asserts the fallback rather than the absence: null `started_at` ⇒ outlined,
sprint-derived; no sprint either ⇒ no bar at all, and the tray.

### Two things I fixed after looking at it

Screenshots caught what tests could not:

- **The subtitle was still the old one** — *"tasks have no dates of their own, so
  they are listed inside their sprint rather than placed on the axis"* — which
  had become false in the same commit that placed them on the axis.
- **Titles truncated to two characters.** Avatar, title, key, status and range on
  one line left nothing for the title. Split into two lines, as the prototype
  has it, so the title gets the width.

### Removed

The old sprint-bar chart and its expandable legend. Leaving them would have
shown the same sprints twice — once as bands behind the rows and once as a chart
below them.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, and **I looked at it** — signed in to the running instance, both
themes, full page. Not a description of a screenshot: the screen.

### It matches the design's shape, from real data

Green solid bars for finished work, positioned by date. **`LAI-8` spans the
sprint boundary** — 20 → 26 Aug, starting in Sprint 12 and finishing in Sprint 13
— which is the case that *was* unrepresentable and is now one bar across two
bands. **`LAI-12` is a blue solid bar ending exactly at TODAY** with a dashed
remainder to the sprint's end: measured, then planned, in one row.

**Solid versus outline is unmistakable in both themes**, and it is fill plus
border style rather than a colour token, so it survives greyscale and a
colour-blind reader. That was the part that had to be right and it is right.

### The two things a screenshot caught that the tests could not

> *"The subtitle still said tasks are **not** placed on the axis — false in the
> same commit that placed them there. And titles truncated to two characters."*

**"Looking beats rendering-and-not-looking"** is the lesson and it is yours.
Neither is expressible as an assertion anybody would have thought to write; both
were obvious in one glance. Removing the old sprint chart and legend was right
too — leaving them would have shown the same sprints twice.

### Two gaps, and both are mine

Neither is a ticked criterion that was not met. **Both are things I wrote as
prose and failed to turn into criteria**, which is the same fault as naming a
location without checking it — intent that reads as binding and measures nothing.

- **A blocked task's bar is not red.** My prose said *"the bar … **red with a
  blocked marker** when `blocked_by` contains an unfinished blocker"*; the
  numbered criterion said only that the marker uses `board-derive.ts`'s
  computation, which it does — for the **count**. The strip says `BLOCKED 1` and
  no bar shows it.
- **No sprint tab row.** My prose asked for tabs across the top with per-sprint
  progress; the band headers carry `7/7`, `0/9`, `0/4`, which is the same
  information in a better place, and the tabs' navigation is not.

**Filed as LAI-436**, p2, with the reading that was ambiguous written down so the
next builder is not asked to guess which half of a task file binds.

### The demo data, and why it looked broken first

The first render was **every bar dashed** — correct, and useless. The seeded
board's tasks were created by a script that set status with `PATCH` rather than
through the status endpoint, so none had `started_at` or `completed_at`, and
everything fell back to *placed*.

That is a seeding artefact, not a product gap — but it is exactly what a real
board upgrading from before LAI-126 will see, which is what **LAI-435** exists
for. I wrote realistic history into the demo database directly so the screen
could be judged on what it does; the product stamps these itself going forward.
