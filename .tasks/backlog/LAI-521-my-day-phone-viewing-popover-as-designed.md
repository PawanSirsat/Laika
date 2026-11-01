---
id: LAI-521
title: 'On a phone, My day''s Viewing switch opens the design''s 280px list with each person''s role, under the bar'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-518
status: backlog
---

## Goal

LAI-518 built the design's phone page but left the Viewing switch as the
shared `Dropdown`, which places its own panel. The design draws a 280px list
under the bar with each person and their role.

## Acceptance criteria

- [ ] At 390 and 360px the Viewing switch opens a 280px panel under the bar,
      one row per person with their role, the reader first as *Me*.
- [ ] The desktop switch is unchanged; both themes; a browser test.

## Notes / context

`docs/design/MyDay.dc.html` (`lay.phone`, the people popover). No native
`<select>` (`no-native-select.test.ts`).
