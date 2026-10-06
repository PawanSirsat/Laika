---
id: LAI-703
title: 'Every screen reads the whole list, not page one'
area: web
assignee: chief
priority: p1
depends-on: [LAI-702]
discovered-from: LAI-702
status: in-progress
started: 2026-10-06T12:30:15Z
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

- [ ] One shared helper reads every page through `next_cursor`, with a page
      cap that reports `truncated` rather than stopping silently; it has its
      own unit test (pages followed, cursor passed through, cap reported).
- [ ] Every call site under *Wrong today* and *Correct today, wrong past a
      page* reads every page through it. Functions that took no cursor gain
      an optional one without changing how existing callers call them.
- [ ] Browser tests for the live four: Calendar, Activity, Meeting review and
      Unlisted each served two pages, asserting a row from the second page is
      on screen — red against the one-page code.
- [ ] A guard test fails if a screen calls a page-returning list function
      and reads `.data` without going through the helper, with an explicit
      list of allowed exceptions and why (the `use-events` window).
- [ ] Both themes untouched; the gate exits 0 on all three.

## Notes / context

`api/use-board.ts`' `fetchEveryPage` is the pattern; the helper generalises
it. No new dependency, no server change (the server half is LAI-704).
