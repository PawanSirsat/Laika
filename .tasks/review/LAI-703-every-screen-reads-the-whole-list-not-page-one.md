---
id: LAI-703
title: 'Every screen reads the whole list, not page one'
area: web
assignee: chief
priority: p1
depends-on: [LAI-702]
discovered-from: LAI-702
status: review
started: 2026-10-06T12:30:15Z
finished: 2026-10-06T12:39:10Z
---

## Goal

LAI-702 is one instance of a defect the owner asked to have swept: *"find if
there are more of the same kind of issue in the website and fix it."* Every
list endpoint pages (default 50, maximum 200, §6.3), and a screen that reads
`page.data` without following `next_cursor` shows part of a list as if it
were the whole of it — with nothing on screen to say so.

## The census (every call of a page-returning client function, 2026-10-06)

Measured against production the same day: Onroute has 328 tasks, 268 open;
the org has 58 unlisted-work rows.

**Wrong today**
- `CalendarScreen` — tasks, one page of 200 (128 missing on Onroute).
- `ActivityScreen` — tasks, one page of 200.
- `MeetingReviewScreen` — tasks, **one page of the default 50**: a proposal
  naming a task outside the first 50 cannot be linked.
- `UnlistedScreen`, `CapacityScreen` — unlisted work, default 50 of 58.

**Correct today, wrong past a page**
- `listProjects({})` in Board, Sprints, Dashboard, Timeline (project picker)
  and Capacity (space count); `use-spaces` (the More-spaces popover, 20).
- `listSprints` default 50 in Board (the strip) and Calendar.
- A task's comments (100) and history (50) in `use-task-detail`.
- Meeting reviews (Space bar badge and the screen), tokens, a user's tokens,
  invites — each a function with **no cursor parameter at all**.
- `SubtasksSection` — children, one page of 200.

**Already right, left alone:** `use-board` (`fetchEveryPage`), `use-sprints`,
`use-dashboard` (`walk`), `listAllUsers`, `countAllSprints`, `use-projects`
(Load more), `use-events` (a deliberate recent window).

## Acceptance criteria

- [x] One shared helper reads every page through `next_cursor`, with a page
      cap that reports `truncated` rather than stopping silently; it has its
      own unit test (pages followed, cursor passed through, cap reported).
- [x] Every call site under *Wrong today* and *Correct today, wrong past a
      page* reads every page through it. Functions that took no cursor gain
      an optional one without changing how existing callers call them.
- [x] Browser tests for the live four: Calendar, Activity, Meeting review and
      Unlisted each served two pages, asserting a row from the second page is
      on screen — red against the one-page code.
- [x] A guard test fails if a screen calls a page-returning list function
      and reads `.data` without going through the helper, with an explicit
      list of allowed exceptions and why (the `use-events` window).
- [x] Both themes untouched; the gate exits 0 on all three.

## Notes / context

`api/use-board.ts`' `fetchEveryPage` is the pattern; the helper generalises
it. No new dependency, no server change (the server half is LAI-704).

## Built — CHIEF, 2026-10-06

**What changed.** The helper is LAI-702's `api/every-page.ts`, extended with an
optional trailing `PageQuery` for the seven list functions that took no
cursor (task comments and history, invites, meeting reviews, both token
lists) — existing calls are unchanged. Every call site in the census now reads
through `everyPage`: Calendar, Activity, Meeting review (tasks and reviews),
the Space bar's review badge, Unlisted and Capacity (unlisted work and the
space count), the project pickers on Board, Sprints, Dashboard and Timeline,
the Board's sprints, the sidebar's spaces, a task's comments and history,
tokens, a user's tokens, invites and the Subtasks section. The unlisted list
gained a `limit`, so it reads 200 at a time like the rest.

**Guard.** `test/api/one-page-reads.test.ts` finds every call of a
page-returning function under `src/` and fails on one not inside `everyPage`,
with seven named exceptions (their own loops, Load more, the live window), a
positive control, and a check that no exception goes stale.

**Measured, and the instrument checked.** Each new browser test was run
against its screen's pre-fix version: Activity, Unlisted, Calendar and Meeting
review each fail exactly the new test and nothing else; the guard fails
against the old Calendar and the old task detail. The first attempt at this
**proved nothing** — zsh read `$pre:server` as a modifier, `git show` failed,
and each screen was swapped for an empty file; caught by the 0-pass counts and
re-run with the variable braced and the swap verified (non-empty, different,
no `everyPage`). Web `1219/1219`, lint, format, `tsc` exit 0.

**Not surfaced on screen:** `truncated` beyond the strip. The cap is 25 pages
(5,000 rows) per list; reaching it elsewhere is reported by the helper and
not yet drawn.
