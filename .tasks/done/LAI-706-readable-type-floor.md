---
id: LAI-706
title: 'Small text is readable: lift every size under 13.5px, change nothing else'
area: web
assignee: chief
priority: p1
depends-on: []
finished: 2026-10-07T07:21:19Z
started: 2026-10-07T07:08:00Z
status: done
---

## Goal

The owner, 2026-10-07, with crops of the sprint edit form, the sidebar and the
Timeline: *"there so many text on this website that is too small make that in
a way the design will not change and not interrupted"*. The prototype's scale
(LAI-605) runs from 7.5px to 10px for labels, meta, field labels, sidebar
items and counts. Read on a laptop screen, a lot of it is too small to read.

## Acceptance criteria

- [x] One monotone mapping lifts every font size **below 13.5px**, everywhere
      it is declared: the `--text-*` tokens in `styles/theme.css`, the type
      roles in `theme/type-roles.ts` (with `styles/type.css` regenerated) and
      the density overrides, and every literal `font-size` in
      `server/web/src/**/*.css`. Sizes of 13.5px and up are unchanged, so card
      titles, the space title and headings keep their size.
- [x] The order of sizes is kept: if A was smaller than B, A is not larger
      than B afterwards.
- [x] Nothing else changes: no spacing, colour, weight, radius or layout
      value. The diff touches `font-size` declarations, `--text-*` and
      role/density `size` fields, and nothing else.
- [x] A guard test fails if any `font-size` under the new floor appears in
      `server/web/src`, so a new component cannot reintroduce 8px text.
- [x] Checked in a browser, both themes, on the Board, List, Timeline,
      Calendar, Sprints (with the edit form open), Capacity, Dashboard and
      the sidebar: no clipped labels, no overlapping text, no row that grew
      enough to change the layout.

## Notes / context

Owner-directed, filed and built by CHIEF under the owner's instruction. It
moves the LAI-605 scale, which the owner chose then; this is the owner
choosing again, so D-020 is satisfied.

## Build notes (CHIEF, under the owner's instruction)

**The mapping**, px → px, applied by one script to every site:
7.5→10, 8→10.5, 8.5→11, 9→11.5, 9.5/9.6/10→12, 10.5/11→12.5, 11.5/12→13,
12.5/13→13.5. 13.5 and up are unchanged, so the card title stays 13.5px and
`card-anatomy.test.ts` did not move.

**Two exceptions to the criterion "nothing else changes", both found by
measuring rather than looking.** A script compared every text element's
`scrollWidth`/`clientWidth` before and after the change on 12 screens:

1. **Avatar initials keep the prototype's sizes.** They sit in circles of a
   fixed size. Lifted, `MK` and `JA` no longer fit. 18 avatar rules and the
   `avatar` role were restored, and `type-floor.test.ts` exempts them by
   selector, with a positive control.
2. **Five fixed boxes were widened just enough for their text**, each with a
   comment naming LAI-706:
   - `.sprint-status`: 62 to 78px, so COMPLETED fits.
   - `.sprint-figures`: 150 to 200px, so `0 in flight · 0 unassigned` stays
     on one line, plus `nowrap` on `.sprint-flow`.
   - `.dash-event .dash-when`: 74 to 96px, so `3 minutes ago` fits.
   - Timeline `--tl-label`: 250 to 300px, so a row's key, status and dates fit.
   - `.tl-dates` may now shrink with an ellipsis, so a planned range's
     `· sprint` gives way instead of running over the chart.

After these, the only text the measurement finds newly cut short is sprint
names in the strip chips, one blocked-banner title and the trailing
`· sprint` note. All of these already truncated by design.

**Not touched, and already wrong before this change:** the space header's
presence avatars overlap their initials (`JA MI PS PR`), and the Timeline's
TODAY tag sits over the `OCT 2026` month label. Both are the same before and
after.

**Verified:** 28 screenshots before and after (14 screens × both themes) on a
seeded local instance on port 3471. The root gate, test, lint and format,
each exited 0. `type-floor.test.ts` goes red when one 8px value is put back
in `sidebar.css` and green when it is restored.
