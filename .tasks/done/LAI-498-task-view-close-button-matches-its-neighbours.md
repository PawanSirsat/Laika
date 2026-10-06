---
id: LAI-498
title: 'The task view’s close button is drawn like the three buttons beside it'
area: web
assignee: chief
priority: p2
depends-on: [LAI-494]
status: done
closed: 2026-10-06T09:13:49Z
finished: 2026-10-06T09:13:48Z
started: 2026-10-06T09:11:53Z
---

## Goal

The owner's screenshot of the task view header after LAI-494: the eye, the
share and the `⋯` are 2rem squares with a 7px radius; the `×` beside them is
a shorter pill with a larger radius and its own font size. It reads as a
different control. It should be the fourth of the same row.

## Acceptance criteria

- [x] In the header, `.panel-close` has the same height, border radius, border
      colour and text colour as `.panel-head-action`, and is at least as wide
      as it is tall; the glyph is centred.
- [x] A browser test measures the close button against the `⋯` button in the
      same header and asserts equal height and equal border radius; it was
      red before the change.
- [x] The drawer still closes from it; `task-drawer.test.ts`'s visibility
      check stays green. Both themes.

## Notes / context

Owner-directed, 2026-10-06. CSS only: `.panel-head-actions .panel-close` in
`task-panel.css`, beside the header geometry LAI-494 added at
`.panel-head-actions .panel-head-action`. `TaskDetailPanel.tsx` is not
touched, because another session holds uncommitted edits to it (LAI-495).

## Built

- `task-panel.css`: `.panel-head-actions .panel-close` takes the row's 2rem
  square, 7px radius, border and colour; only the glyph is its own.
- `task-drawer.test.ts`: measures the × against the `⋯` in the same header
  (height, width ≥ height, radius, border, colour). Red before the CSS
  (16px against 32px), green after.
- Seen through the harness in dark and light: four matching squares.
- Lint 0, format 0, typecheck 0; the drawer suite 6/6.

## Review

Accepted 2026-10-06T09:13:49Z by CHIEF, who built it on the owner's instruction. Two
files, both `server/web/`; `TaskDetailPanel.tsx` untouched, as the notes
required. The test was shown red before the CSS. Both themes seen.

