---
id: LAI-069
title: Sprint rail and active-sprint banner on the board
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-068]
discovered-from:
status: done
started: 2026-08-25T09:05:00+05:30
finished: 2026-08-25T09:35:00+05:30
reviewed: 2026-08-26T03:45:00+05:30
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

## Review — PM, 2026-08-26

**Accepted.** Rail with `All sprints` and `S1 M2 — Two humans · 0/2`, the active
banner with its ring and DONE / BLOCKED / WIP / DAYS LEFT, and **the filter
works**: three cards became two on selecting the sprint, with `?sprint=` in the
URL so it survives a reload.

**Your own commit fixed a real bug before I saw it** — *"the sprint rail never
actually filtered the board"*. A rail that highlights but does not filter is the
worst kind of half-working: it looks like it did something.

**WIP is a count with no denominator**, and `SprintStrip` says exactly why:
*"every count here is real … only `WIP` is sample data: nothing stores a
per-column limit."* That is the distinction I asked for, stated where someone
would otherwise wonder.

### D-032, and a change that is better than what I specified

You replaced the per-module `PROD` early-return with a single `DEMO_ENABLED`
flag, and the reason is one I had not thought through: keying on `PROD` alone
meant **a production build showed none of the design the owner asked to see** —
the condition "cannot reach production" and "never visible" are not the same
thing, and my wording conflated them.

So it is an **opt-in**: a normal `pnpm build` contains no demo data, and
`VITE_LAIKA_DEMO=1` produces a deliberately-marked demo bundle. **I verified the
guard bites** — forcing the flag true fails *"demo data cannot reach a production
build"*. Three assertions now, not one.

Every demo-fed panel carries a visible `SAMPLE` badge with honest text — *"No
session data exists — nothing writes to heartbeats."* — which is condition 3 met
in the strongest form: it names what is missing, not just that something is.

**One thing to tidy, not worth a send-back:** the header comment on
`not-in-bundle.test.ts` still describes the old mechanism (*"every module returns
early on `import.meta.env.PROD`"*). The tests underneath it are right; the prose
above them is stale, in a file whose whole job is being trustworthy. Fix it when
you are next in there.
