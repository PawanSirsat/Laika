---
id: LAI-069
title: Sprint rail and active-sprint banner on the board
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-068]
discovered-from:
status: review
started: 2026-08-25T09:05:00+05:30
finished: 2026-08-25T09:35:00+05:30
---

## Goal

The prototype's board opens with a sprint rail (`All sprints`, S1…S4 with
progress) and, beneath it, a banner for the active sprint: completion ring,
`ACTIVE` badge, name, date range, goal, and the counts DONE / BLOCKED / WIP /
DAYS LEFT.

## Acceptance criteria

- [x] A rail of the project's sprints; selecting one filters the board to it,
      and `All sprints` clears the filter.
- [x] The selection lives in the URL, as the project choice does.
- [x] The active sprint's banner shows name, range, goal, and progress — every
      number derived from real tasks.
- [x] **DONE**, **BLOCKED** and **DAYS LEFT** are derivable and required:
      done/total from task statuses, blocked from `ready === false`, days left
      from `ends_on` (inclusive — the last day counts).
- [x] **WIP is a count, not a limit** — show in-progress tasks, with no
      denominator (see LAI-067).
- [x] No active sprint is a normal state and must render as one.
- [x] Both themes.

## Notes / context

Depends on LAI-068 so the sprint fetching and name resolution exist once, in one
place, rather than twice.

## Notes at review — builder-b

The rail and banner landed with LAI-089. Claiming this task found **two real
defects in them** and one design rule I had broken.

### 1. Selecting a sprint did not filter the board — at all

`?sprint=` went into the URL, into the filter object, and then **nowhere**.
`useBoard` destructured four named fields off `TaskFilter`, rebuilt the request
from those, and depended on exactly them — so a field added to the type later was
accepted by TypeScript and **silently dropped**. No request, no error, no failing
test. I only found it because I compared the card list before and after selecting
and they were identical.

The destructure was there for a good reason — the filter object is rebuilt every
render, so depending on it directly loops. Replaced with a **serialised content
key**, so any field added in future is honoured without anyone remembering.

Guarded by `test/api/use-board-filter.test.ts`, confirmed red against the old
shape. **This is the same family as LAI-213**: a capability declared in a type
and quietly ignored by the code beneath it.

Now verified: selecting Sprint 2 requests `?sprint=spr-2&limit=200` and the board
narrows from four cards to one; `All sprints` restores it.

### 2. DAYS LEFT was off by one on the day that matters

I had `ceil((ends_on - now) / DAY)`. On a sprint's **last day** that is `0` — the
one day where the number is read most and where zero is discouraging and wrong.

`ends_on` is a date at UTC midnight and `now` is an instant, so the raw
subtraction also drifted with the time of day. Added `daysLeft()` **to
`sprint-derive.ts`** — the one place, as this task's note asks — normalising both
to UTC midnight and counting the last day, never negative. Five tests, including
one that the answer does not change between 00:01 and 23:59.

Verified against a sprint whose `ends_on` I set to today: **reads 1**.

### 3. WIP had a denominator, and this task forbids one

LAI-089 shipped `WIP 1/4` using a demo limit. This task says plainly: *a count,
not a limit*. The denominator is gone — `WIP 1`.

That also resolves what I flagged on LAI-067: no invented denominator now exists
anywhere, in any build, so there is nothing left for you to rule on.

### Also verified

Rail lists every sprint with `All sprints`; selection lives in the URL and
survives reload; the banner shows `ACTIVE`, name, `17 Aug – 24 Aug 2026`, goal,
and a ring from real counts; no sprint selected renders as `ALL SPRINTS · Every
task in this project` rather than as an error or a blank. Both themes through the
real control.
