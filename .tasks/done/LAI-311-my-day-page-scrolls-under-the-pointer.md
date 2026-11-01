---
id: LAI-311
title: "My day: the page scrolls wherever the pointer is — To settle, Confirmed and the right column hand the wheel back"
area: web
assignee: strelka
priority: p1
depends-on: []
discovered-from: owner report 2026-10-21
started: 2026-10-21T17:50:06Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-21T18:04:16Z
---

## Goal

On `/my-day`, in both themes, the wheel scrolls the page wherever the pointer
is. Today, with the pointer over the *To settle* or *Confirmed* list, or over
the right-hand column (*Agent minutes* / *On your plate*), the wheel scrolls
that box and the page never moves. The first row under a list's header is
also cut off.

## Acceptance criteria

- [x] A browser test in `server/web/test/browser/` fails on today's code:
      the wheel over *To settle*, over *Confirmed* and over the right column
      moves the page's scroller, and the first row of each list is fully
      visible below its header.
- [x] Fixed in `server/web/` only; the test passes at 1440, 1024 and 390 px,
      light and dark. The design choice (lists not separately scrollable, or
      scrolling and handing the wheel back at their ends) is stated and
      justified in the log.
- [x] Breaking the fix once turns the new test red.
- [ ] The root gate's `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
      **Not met as written**: `pnpm test` exited 1 on LAI-304's known
      timeout only (see Result); lint and format exited 0.

## Notes / context

Owner-direct on the production instance, 2026-10-21. Board card LAI-858
(LAIKA-657) covers the same lists from Belka with the opposite criterion —
*"moves only its list, never the page"*. This task follows the owner's
newer report; the conflict is flagged on both cards.

The page's scroller is `.shell-main` (LAI-601), not `window`.

## Result

- Cause: `.myday-scroll` (both lists) and `.myday-side` were bounded
  `overflow-y: auto` boxes with `overscroll-behavior: contain`, so the wheel
  never chained to `.shell-main`. At 390 the inner list scrolled its first
  rows out above the header.
- Design: the lists have no scroll of their own — a page of ten is already
  the bound (LAI-810). The column stays sticky and bounded and hands the
  wheel back at either end. `my-day-bulk.test.ts`'s LAI-810 assertion that
  the list scrolls on its own is inverted accordingly.
- Red on 66cec001: 18/18 wheel cases moved the page 0px; 4/4 first-row
  cases cut off at 390. Mutations: restoring both containments → 22 red;
  the column's alone → its 6 red.
- Gate at 43ca4302: `pnpm test` EXIT 1 (only LAI-304's
  `sprints.test.ts` 5 s timeout, load ~40; server untouched), `pnpm lint`
  EXIT 0, `pnpm format` EXIT 0. The file alone: EXIT 1 (same timeout), then
  EXIT 0, 43/43.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #22.
