---
id: LAI-892
title: "My day Timeline: a row-height control you can see — a grip band along the row and a slider in the YOU box"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-891
status: in-progress
started: 2026-10-22T14:19:21Z
---

## Goal

LAI-891's grip was a 40×4px pill at the row's edge, grey until hovered: the
owner could not find it. The row height gets a control one can see: a grip
band along the whole bottom edge of the YOU row with a handle and a label on
hover, and a *Row height* slider in the YOU box of the lane column.

## Acceptance criteria

- [ ] A grip band spans the bottom of the YOU row, at least 8px tall, its
      handle at least 48px wide and drawn without hovering; the cursor is
      ns-resize over it and a label says *drag to resize rows* on hover.
- [ ] A slider labelled *Row height* in the YOU box of the lane column sets
      the same height, 80 to 240 in steps of 8, and moves when the band is
      dragged.
- [ ] The band lies under the blocks, never over one; the lane column, lanes
      and blocks line up as LAI-891 left them.
- [ ] The browser test finds the band and the handle drawn, drags the band,
      and steps the slider.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction in the temporary worktree
  `Laika-myday-rows` on `LAI-892-visible-row-height`. No new dependencies.
