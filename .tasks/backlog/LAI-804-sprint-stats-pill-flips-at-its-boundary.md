---
id: LAI-804
title: 'The board toolbar''s sprint figures flip between pill and compact when hovered at their boundary width, and the pill never opens'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

`SprintStats` (LAI-727) picks its tier — full, compact, pill — by measuring
before paint. At a main column of about **860px** the toolbar sits on the
pill/compact boundary, and hovering the pill re-measures and flips it:
measured on LAI-796's branch, the group's class went `pill → compact (×5) →
pill (×9)` within 1.5s of one `hover()`, with the pointer still. The
`mouseenter` lands while the group is *compact* (no handlers), so the pill
comes back closed with `aria-expanded="false"` and its BLK / LEFT tooltip
never shows until the pointer moves again.

LAI-796 made the sidebar an automatic 60px icon rail at windows of 1180px and
under, so a 920px window now gives the board exactly that 860px column. The
same flip is reachable at any window that leaves the toolbar that wide
(before LAI-796, about 1072px with the 212px sidebar).

## Acceptance criteria

- [ ] At the pill/compact boundary, hovering, focusing or clicking the pill
      does not change its tier; the tooltip opens on the first hover.
- [ ] A browser test at the boundary width — found by measuring, not by a
      guessed pixel — hovers once without moving and sees the tooltip.
- [ ] `board-sprint-stats.test.ts`'s pill test no longer needs to open the
      sidebar at 920px (LAI-796 added that to keep its original geometry);
      remove that step and it stays green.
- [ ] Gate: test, lint, format exit 0.

## Notes / context

- Likely a tier decision that depends on something the open state changes
  (the popover, `aria-describedby`, the focus ring), or a measurement that
  runs again on the re-render the hover causes. A small hysteresis on the
  boundary is one answer; not re-measuring on state that does not change the
  width is another.
- Reproduce: `/board?project=laika-core&sprint=s2&group=assignee` with the
  `SIX_MEMBERS` stub, viewport 920×768, sidebar collapsed, `pill.hover()`.
