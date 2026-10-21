---
id: LAI-311
title: "My day: the page scrolls wherever the pointer is — To settle, Confirmed and the right column hand the wheel back"
area: web
assignee: strelka
priority: p1
depends-on: []
discovered-from: owner report 2026-10-21
started: 2026-10-21T17:50:06Z
status: in-progress
---

## Goal

On `/my-day`, in both themes, the wheel scrolls the page wherever the pointer
is. Today, with the pointer over the *To settle* or *Confirmed* list, or over
the right-hand column (*Agent minutes* / *On your plate*), the wheel scrolls
that box and the page never moves. The first row under a list's header is
also cut off.

## Acceptance criteria

- [ ] A browser test in `server/web/test/browser/` fails on today's code:
      the wheel over *To settle*, over *Confirmed* and over the right column
      moves the page's scroller, and the first row of each list is fully
      visible below its header.
- [ ] Fixed in `server/web/` only; the test passes at 1440, 1024 and 390 px,
      light and dark. The design choice (lists not separately scrollable, or
      scrolling and handing the wheel back at their ends) is stated and
      justified in the log.
- [ ] Breaking the fix once turns the new test red.
- [ ] The root gate's `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

Owner-direct on the production instance, 2026-10-21. Board card LAI-858
(LAIKA-657) covers the same lists from Belka with the opposite criterion —
*"moves only its list, never the page"*. This task follows the owner's
newer report; the conflict is flagged on both cards.

The page's scroller is `.shell-main` (LAI-601), not `window`.
