---
id: LAI-499
title: 'The Details card’s Assignee control is drawn like the rail’s other fields'
area: web
assignee: chief
priority: p2
depends-on: [LAI-494]
status: review
finished: 2026-10-06T10:02:53Z
started: 2026-10-06T09:57:29Z
---

## Goal

The owner's crop of the Details card: under ASSIGNEE, the avatar sits beside a
native `<select>` drawn as a bright boxed control with the browser's own
arrow — the board card's assign control (`assign.css`) dropped into a rail
whose Priority and Sprint fields read as text with a border on hover
(`.meta-select`). It should read as the third of those, in both themes.

## Acceptance criteria

- [x] In `.meta-person`, the assign select has no native chrome
      (`appearance: none`), a transparent background and border at rest, the
      rail's font size and weight, the rail's hover/focus border and card
      background, a drawn chevron, and fills the row's width with the name
      ellipsised rather than overflowing the card.
- [x] The select carries `color-scheme` matching the theme, so the native
      option list is dark in dark and light in light.
- [x] A browser test asserts, on the open Details card, that the assign
      select's computed `appearance` is `none`, its resting background is
      transparent, and its width is at least 60% of the card's; red before
      the change. Both themes seen.

## Notes / context

Owner-directed, 2026-10-06. CSS only, in `task-panel.css` beside the existing
`.meta-person select` rule; `assign.css` and `AssignControl.tsx` stay as the
board card's own.

## Built

- `task-panel.css`: in `.meta-person`, the assign select has no native chrome,
  nothing painted at rest, the rail's hover border and card background, a
  drawn chevron, `color-scheme` per theme, and fills its row with the name
  ellipsised. `assign.css` and `AssignControl.tsx` are untouched, so the board
  card keeps its own control.
- `task-drawer.test.ts`: one test on the open Details card asserting
  `appearance: none`, a transparent background at rest, and right edges — the
  control reaches the row's end and the select reaches its box. **Re-aimed
  from AC3's "60% of the card"**: the fixture's task is unassigned, so a
  Claim button shares the row and a share of the card measured the fixture,
  not the property. Red on the old CSS (`appearance: auto`), green on the new.
- Mutation: dropping `flex: 1` from `.meta-person .assign` turns it red on
  *"the control stops short of its row"*. Restored by checksum.
- Seen through the harness: dark assigned, dark hovered, dark unassigned with
  Claim, light assigned.
- Gate on this branch: test 0 (server 2065/2065, web 1199/1199, cli 85/85),
  lint 0, format 0.

