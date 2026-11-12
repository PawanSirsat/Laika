---
id: LAI-1174
title: 'My day: the View — Day, Week, Month and Year, with the zoom between them'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1173]
status: backlog
---

## Goal

The owner's *My Day Calendar Zoom* design (Claude Design project `34bdf78e…`):
switch My day between Day, Week, Month and Year, with its zoom animation.
**Nothing is removed**: Day stays the page as it is. The owner decided on
2026-11-12:

- Bars and heat are relative to the busiest day, with no 8 h target.
- Phones get a compact switch.
- The zoom uses an even scale (the design's stretch dropped), plus
  Ctrl/⌘ + scroll and pinch.
- Data comes from LAI-1173's `GET /me/time/days`.

## Acceptance criteria

- [ ] A *Day · Week · Month · Year* radio group, with − / +, on My day. The
      view is `?span=` in the address beside `?day=`, Day when absent.
      Back and forward walk the views.
- [ ] Day is unchanged; the existing My day browser tests pass untouched.
- [ ] Week: seven columns over the hours its blocks fill, with no fixed-window
      clamp. Two blocks at once sit side by side. A block opens its day with
      the block in the editor.
- [ ] Month: Monday-first weeks. Each day shows its total, its top two tasks
      and a bar; a week number opens the week; a day nothing reached shows `—`.
- [ ] Year: twelve months, heat by quartile of the year's own working days,
      today ringed. A month opens Month and a day opens Day.
- [ ] No target: every bar is a share of the period's busiest day.
- [ ] Keys: D W M Y, − / +, Esc a step out, ← → a period. The shortcut sheet
      lists them.
- [ ] The zoom from and to the opened part: 520 ms on the design's curve,
      one scale for both axes. Reduced motion means no movement.
- [ ] Wider views edit nothing: Add time, Fill gaps, Confirm day, the lists
      and the drawer are Day's.
- [ ] `?user=` reads the same views through `/people/:id`.
- [ ] Phone (390 px): a compact switch, Week as a list, no sideways scroll,
      both themes.
- [ ] Tests: `span`, `span-derive` and `span-motion` unit tests;
      `browser/my-day-span.test.ts`.
- [ ] Named cross-area edit (D-033): SPEC §11.4.2's My day row and the
      §11.4.2.1 My day bullet name the View.

## Notes / context

Plan agreed 2026-11-12. Branch cut from `LAI-1173-my-days-range` (#333), which
must merge first.
