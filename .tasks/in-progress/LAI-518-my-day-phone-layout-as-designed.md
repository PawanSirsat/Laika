---
id: LAI-518
title: 'My day on a phone as designed: the top bar, the day row with icon buttons, the letter week with dots, the summary row with Confirm, the vertical Timeline (TimelineMobileV2) with SIG / YOU / AGENTS columns, compact list rows, a wrapping bulk bar'
area: web
assignee: chief
priority: p1
depends-on: [LAI-511, LAI-512]
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T02:05:00Z
---

## Goal

Under 760px the design is a different page: `TimelineMobileV2.dc.html` is a
vertical Timeline, the header is a day row with icon buttons, and the editor
is the bottom sheet LAI-511 builds. D-110 item 10 kept the horizontal
Timeline; the owner on 2026-10-25 chose the design as it is.

## Acceptance criteria

- [ ] Top bar 48px: ☰, the logo, *Laika*, the eye with its badge, *Viewing
      Me ▾*, the avatar. The app shell's own phone header gives way to it on
      My day only.
- [ ] Day row: ‹ `Thu 22 Oct` / *Today* ›, then the timer button (or the
      running pill with its clock and stop), Add time, Day settings, all
      40px; the letter week (M T W T F S S with a dot each: filled when
      settled, half for today, dashed for no signal) in a 7-column grid.
- [ ] Summary row: the mono 18px total and the sub line; *Confirm 2 h 42
      min* (44px) when the day is the person's own.
- [ ] The Timeline card is the design's vertical one: title and date, the
      three-item legend, ‹ ● Now › and Fit / 1× / 2× (36px), the column
      heads SIG · YOU `6h 03m` · AGENTS, the totals line, a 340px scrolling
      track with hour labels at the left, signals in a 36px column, blocks
      in the YOU column (icon chip, key, length at the right, range on a
      second line, title on a third when tall enough), agents in a 64px
      column, the now pill, *Later today* and *No activity* stretches, Fit
      folding; a tap on a block, a gap or an agent opens the sheet.
- [ ] Tray *Tap to set a time*; tabs scroll sideways; list rows put the
      range and length under the label; the bulk bar wraps to two rows.
- [ ] The Day settings and Viewing popovers as the design draws them on a
      phone; the Who looked popover 280px.
- [ ] Both themes at 390 and 360px; new browser tests for the vertical
      Timeline (a block's lines, Fit, Now) and the day row; `my-day-header`'s
      phone cases re-aimed.

## Notes / context

Design: `MyDay.dc.html` (`lay.phone`, the phone header) and
`TimelineMobileV2.dc.html`. The vertical Timeline is a new component beside
`Timeline.tsx`, sharing `timeline-derive.ts`. Depends on LAI-511 (the sheet)
and LAI-512 (the shared derive for the timer block and drag states).
