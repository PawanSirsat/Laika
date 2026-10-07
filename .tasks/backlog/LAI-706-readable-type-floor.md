---
id: LAI-706
title: 'Small text is readable: lift every size under 13.5px, change nothing else'
area: web
assignee: unclaimed
priority: p1
depends-on: []
status: backlog
---

## Goal

The owner, 2026-10-07, with crops of the sprint edit form, the sidebar and the
Timeline: *"there so many text on this website that is too small make that in
a way the design will not change and not interrupted"*. The prototype's scale
(LAI-605) runs from 7.5px to 10px for labels, meta, field labels, sidebar
items and counts. Read on a laptop screen, a lot of it is too small to read.

## Acceptance criteria

- [ ] One monotone mapping lifts every font size **below 13.5px**, everywhere
      it is declared: the `--text-*` tokens in `styles/theme.css`, the type
      roles in `theme/type-roles.ts` (with `styles/type.css` regenerated) and
      the density overrides, and every literal `font-size` in
      `server/web/src/**/*.css`. Sizes of 13.5px and up are unchanged, so card
      titles, the space title and headings keep their size.
- [ ] The order of sizes is kept: if A was smaller than B, A is not larger
      than B afterwards.
- [ ] Nothing else changes: no spacing, colour, weight, radius or layout
      value. The diff touches `font-size` declarations, `--text-*` and
      role/density `size` fields, and nothing else.
- [ ] A guard test fails if any `font-size` under the new floor appears in
      `server/web/src`, so a new component cannot reintroduce 8px text.
- [ ] Checked in a browser, both themes, on the Board, List, Timeline,
      Calendar, Sprints (with the edit form open), Capacity, Dashboard and
      the sidebar: no clipped labels, no overlapping text, no row that grew
      enough to change the layout.

## Notes / context

Owner-directed, filed and built by CHIEF under the owner's instruction. It
moves the LAI-605 scale, which the owner chose then; this is the owner
choosing again, so D-020 is satisfied.
