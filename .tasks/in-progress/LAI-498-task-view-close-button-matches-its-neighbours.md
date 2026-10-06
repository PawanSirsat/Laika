---
id: LAI-498
title: 'The task view’s close button is drawn like the three buttons beside it'
area: web
assignee: chief
priority: p2
depends-on: [LAI-494]
status: in-progress
started: 2026-10-06T09:11:53Z
---

## Goal

The owner's screenshot of the task view header after LAI-494: the eye, the
share and the `⋯` are 2rem squares with a 7px radius; the `×` beside them is
a shorter pill with a larger radius and its own font size. It reads as a
different control. It should be the fourth of the same row.

## Acceptance criteria

- [ ] In the header, `.panel-close` has the same height, border radius, border
      colour and text colour as `.panel-head-action`, and is at least as wide
      as it is tall; the glyph is centred.
- [ ] A browser test measures the close button against the `⋯` button in the
      same header and asserts equal height and equal border radius; it was
      red before the change.
- [ ] The drawer still closes from it; `task-drawer.test.ts`'s visibility
      check stays green. Both themes.

## Notes / context

Owner-directed, 2026-10-06. CSS only: `.panel-head-actions .panel-close` in
`task-panel.css`, beside the header geometry LAI-494 added at
`.panel-head-actions .panel-head-action`. `TaskDetailPanel.tsx` is not
touched, because another session holds uncommitted edits to it (LAI-495).
