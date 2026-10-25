---
id: LAI-523
title: 'My day on a phone: the vertical Timeline gets D-113 — crowded stretches as groups that open into lanes, and one zoom set by pinch'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-300]
discovered-from: LAI-300
status: backlog
---

## Goal

D-113 (LAI-300) gave the desktop Timeline one *Time zoom* slider, *Fit day*,
*Expand all*, and groups for a crowded stretch that open in place into
readable lanes. The phone's vertical Timeline (`TimelineMobile.tsx`, at 900px
and under) was left as it was so LAI-300 could not regress it: it still has
its own *Fit · 1× · 2×* zoom (`timeline-mobile-derive.ts`, `MobileZoom`) and
still lays blocks at the same time side by side with `stackOf`, a column each
— so twelve at once on a 390px phone are twelve slivers. This task brings the
phone the same answer, drawn vertically.

## Acceptance criteria

- [ ] A stretch the phone cannot give each block a readable column (a named
      threshold, unit-tested) is one rounded group with its count and a faint
      preview of its blocks at their true times; a tap opens it in place into
      readable columns with an obvious *Collapse*; any number may be open.
      Reuse `layoutRow`'s clash and stable-id rules from `timeline-derive.ts`
      rather than a second copy.
- [ ] One zoom state for the phone, set by pinch (and by whatever control the
      owner picks for the phone's header — ask before adding one; D-020), with
      *Fit day* closing every group. Zoom keeps the minute under the pinch.
- [ ] Nothing on the phone writes but what writes today; `my-day-phone.test.ts`
      keeps passing, with a new browser test at 390 and 900 wide in both
      themes for a day with twelve blocks at once.
- [ ] No design token or colour changes (D-020).

## Notes

- Filed by CHIEF's builder on LAI-300 from CHIEF's block (D-109; `LAI-950`
  – `LAI-999` was full when the §3 sweep ran).
- The desktop's `layoutRow` works in px along the track; the phone's track
  runs down, so it wants the same function fed the vertical scale, not a
  rewrite.
