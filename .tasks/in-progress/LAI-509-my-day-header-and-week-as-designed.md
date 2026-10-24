---
id: LAI-509
title: 'My day: the header and the week strip look as the design draws them — figures beside the title, the date line, the toolbar row, a compact week of seven tiles with a bar each'
area: web
assignee: chief
priority: p1
depends-on: [LAI-502]
discovered-from: LAI-502
status: in-progress
started: 2026-10-24T12:11:59Z
---

## Goal

The owner, 2026-10-24, on the released header: *"I don't think you checked
the design properly, how it looks and feels; what you built is completely
different."* Rendered side by side, the design's top of page is: the title
with the day's total in mono beside it and "N to review" after it; one date
line with *Who can see this*; the toolbar on its own row — Viewing, a divider,
Start timer, Add time N, Confirm day with its sub-figure, the settings, the
eye, the ?; all on the card colour with a rule under it; then a compact week:
‹ Today › in one bordered group and seven low tiles, each its weekday, date
and figure on one line and a 4px bar (confirmed solid, drafted striped), the
open day in the accent. The built header stacked three lines under the title
and the week kept the tall v2 tiles with status words.

## Acceptance criteria

- [ ] Title row: `My day`, the total in mono, "N to review" muted, on one line; under it the date and *Who can see this* on one line; nothing else above the toolbar.
- [ ] Toolbar on its own row, left-aligned, 34px controls with 9px corners, in the design's order; the Confirm day button carries its sub-figure in mono.
- [ ] The header band and the week band sit on the card colour with a rule under them; the page below is the page colour.
- [ ] Week: ‹ Today › grouped; seven tiles of one line plus a 4px bar; today's and the open day's tile in the accent; no status words; a day with no signal shows — and a hatched track.
- [ ] Both themes at 1440 and 390; every strip and header browser case re-aimed; screenshots compared with the design render.

## Notes / context

The design renders from `MyDay.dc.html` with `support.js` and
`timeline-core.js` beside it, served over HTTP. `ScreenHeader` stays the
frame; My day's CSS reshapes its rows.
