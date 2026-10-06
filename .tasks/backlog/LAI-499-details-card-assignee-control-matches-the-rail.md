---
id: LAI-499
title: 'The Details card’s Assignee control is drawn like the rail’s other fields'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-494]
status: backlog
---

## Goal

The owner's crop of the Details card: under ASSIGNEE, the avatar sits beside a
native `<select>` drawn as a bright boxed control with the browser's own
arrow — the board card's assign control (`assign.css`) dropped into a rail
whose Priority and Sprint fields read as text with a border on hover
(`.meta-select`). It should read as the third of those, in both themes.

## Acceptance criteria

- [ ] In `.meta-person`, the assign select has no native chrome
      (`appearance: none`), a transparent background and border at rest, the
      rail's font size and weight, the rail's hover/focus border and card
      background, a drawn chevron, and fills the row's width with the name
      ellipsised rather than overflowing the card.
- [ ] The select carries `color-scheme` matching the theme, so the native
      option list is dark in dark and light in light.
- [ ] A browser test asserts, on the open Details card, that the assign
      select's computed `appearance` is `none`, its resting background is
      transparent, and its width is at least 60% of the card's; red before
      the change. Both themes seen.

## Notes / context

Owner-directed, 2026-10-06. CSS only, in `task-panel.css` beside the existing
`.meta-person select` rule; `assign.css` and `AssignControl.tsx` stay as the
board card's own.
