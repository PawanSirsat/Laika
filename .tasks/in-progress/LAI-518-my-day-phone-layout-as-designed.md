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

- [x] Top bar 48px: ☰, the logo, *Laika*, the eye with its badge, *Viewing
      Me ▾*, the avatar. The app shell's own phone header gives way to it on
      My day only.
- [x] Day row: ‹ `Thu 22 Oct` / *Today* ›, then the timer button (or the
      running pill with its clock and stop), Add time, Day settings, all
      40px; the letter week (M T W T F S S with a dot each: filled when
      settled, half for today, dashed for no signal) in a 7-column grid.
- [x] Summary row: the mono 18px total and the sub line; *Confirm 2 h 42
      min* (44px) when the day is the person's own.
- [x] The Timeline card is the design's vertical one: title and date, the
      three-item legend, ‹ ● Now › and Fit / 1× / 2× (36px), the column
      heads SIG · YOU `6h 03m` · AGENTS, the totals line, a 340px scrolling
      track with hour labels at the left, signals in a 36px column, blocks
      in the YOU column (icon chip, key, length at the right, range on a
      second line, title on a third when tall enough), agents in a 64px
      column, the now pill, *Later today* and *No activity* stretches, Fit
      folding; a tap on a block, a gap or an agent opens the sheet.
- [x] Tray *Tap to set a time*; tabs scroll sideways; list rows put the
      range and length under the label; the bulk bar wraps to two rows.
- [ ] The Day settings and Viewing popovers as the design draws them on a
      phone; the Who looked popover 280px.
- [x] Both themes at 390 and 360px; new browser tests for the vertical
      Timeline (a block's lines, Fit, Now) and the day row; `my-day-header`'s
      phone cases re-aimed.

## Notes / context

Design: `MyDay.dc.html` (`lay.phone`, the phone header) and
`TimelineMobileV2.dc.html`. The vertical Timeline is a new component beside
`Timeline.tsx`, sharing `timeline-derive.ts`. Depends on LAI-511 (the sheet)
and LAI-512 (the shared derive for the timer block and drag states).

## Build notes

Built on `LAI-516-kinds` (commit `24e05ffc` claimed it). "Phone" is a window of
900px or less, where the sidebar goes off-canvas and the drawer is a sheet; the
design says under 760. The desktop at 1440 is unchanged, and a test says so.

- **Not met: the Viewing popover as the design draws it.** The switch is the
  shared `Dropdown`, whose panel is portalled and placed by itself. The design
  draws a 280px list with roles. Day settings (300px, from the row's right
  edge) and Who looked (280px, under the bar) are as drawn.
- **One button the design does not have.** The bar keeps *Beside your day*
  (Agent time and On your plate). The design's phone has no other way to them.
  Under 380px the switch drops the word *Viewing* so the bar fits.
- **Sizes on the type scale.** The design's 10–11px labels are 12px, the
  floor (`type-floor.test.ts`). Its 15, 17 and 18px are 16, 16 and 20px.
- **No marks in SIG.** The API sends prompts and commits only.
- **An agent's bar says less.** The API has no agent name or card per run, so
  a bar says *Agent*, the minutes worked, and whether it was on a card. A tap
  opens *Beside your day* in the sheet; the design's footer is not drawn.
- **‹ › ring a block and do not open the sheet**, as the design's do. A tap
  opens it.
- **A running timer on a phone** shows the dot, the clock and stop. Pause and
  discard are hidden while it runs; Resume shows when paused. At 360px the
  weekday gives way so the date stays whole.
- **The bulk bar** on this branch sits in the To review card's head, not
  floating (that is LAI-514). On a phone it wraps: count and Confirm, then the
  rest.
- **The organisation's breaks** are drawn on the vertical Timeline as a band,
  so `org-breaks.test.ts` holds at 390.
- **LAI-512 is not on this branch.** The vertical Timeline uses
  `timeline-derive.ts` as it stands here; it has no timer block and no drag.
- **Re-aimed beyond `my-day-header`:** `my-day-v2`, `my-day-v3`,
  `my-day-signals` (SIG in the vertical Timeline) and `my-day-timeline-zoom`
  (390 became 901, the narrowest desktop).
- **Failing before this task, not touched:** `person-day.test.ts`, *her own
  day draws every write control*, at 1440. It waits for the editor on load,
  which LAI-511 closed on load. It fails the same at `24e05ffc`, measured with
  this work stashed.

