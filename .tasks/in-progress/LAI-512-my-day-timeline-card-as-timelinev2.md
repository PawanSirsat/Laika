---
id: LAI-512
title: 'My day: the Timeline card as TimelineV2 draws it — one header row with the legend inline, no footer, Marks and Expand in the lane column, sun and moon on the hours, a running timer on the track, and blocks that move and resize by drag, tray items that drop onto the track, Alt+arrows that move a block'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T01:10:00Z
---

## Goal

`TimelineV2.dc.html` (LAI-510) is the Timeline card the owner's My day
embeds with `no-footer`. Measured beside master on 2026-10-24: the design's
header is one row — *Timeline*, the date in mono, the legend inline with
compact figures (`Confirmed 2h 10m · Drafted 2h 42m · No task yet 1h 26m ·
Gaps 35m`), then ‹ ● Now › and Fit / 1× / 2× — while master wraps the legend
over three rows and says *Needs a card* and *3 unaccounted · click to fill*.
The design has no footer; master shows the keys row. The design's lane
column has a Marks row and an Expand button; master's agents text truncates.
The design moves and resizes blocks by drag, drops tray items onto the track,
moves the focused block with Alt+arrows, and draws a running timer on the
track. The owner: *"as per design … also want drag … i want zoom"* — so the
zoom stepper and slider (LAI-890, LAI-891) and the row-height grip (LAI-892)
stay, inside the design's header group.

## Acceptance criteria

- [ ] Header, one row that wraps only when the card is narrow: *Timeline*,
      `Thu 22 Oct` in mono, the four legend items with a 16×12 swatch, the
      label and the figure in mono bold, compact (`2h 10m`, `35m`, as
      `timeline-core.js`'s `dur`); labels *Confirmed · Drafted · No task yet ·
      Gaps*; Gaps still opens the first gap. Right: the ‹ ● Now › group
      (30px, 9px radius) and the zoom group: Fit / 1× / 2× as the design's
      radio plus the − 1× ─●─ + stepper and slider kept beside it. No
      *scroll sideways* word; the axis note says *Idle hours folded* on Fit.
- [ ] No footer under the track (the keys row and the no-set-time line go;
      the keys stay on the ? sheet, the tray says what has no set time).
- [ ] Lane column 148px: SIGNALS with Prompts, Commits and Marks rows
      (glyph, word, figure in mono); YOU with the mono 17px total and *of work
      · Xh Ym confirmed*; AGENTS with an Expand/Collapse button, `N agents ·
      Xh Ym`, and *Beside your day. Never added to your hours.* — nothing
      truncated at 1440. The row-height grip stays, under YOU.
- [ ] Hour labels carry the design's sun (before 5 PM) and moon (6 PM on)
      icons; the card's radius is 16px; the now pill is red with the clock.
- [ ] A running timer draws as the design's `S.timer` block at its start to
      now (striped accent), *LAI-867 · 42m · running* or *paused*, the now
      line at its end; clicking it opens the timer popover.
- [ ] Drag: a drafted or confirmed block moves by its body and resizes by
      either 9px edge, on the 5-minute grid, with the design's floating label
      (`3:40–4:50 PM · 1h 10m`), a dashed ghost at the old place, and a red
      label + bounce back after 1.6s when the result would overlap confirmed
      time (`Overlaps LAI-860, 12:30–1:30 PM`) or cross midnight. A drop
      writes the moved edges (`started_at`/`ended_at` + `minutes`) through
      the existing update routes and says *Moved … to …* with Undo.
- [ ] Alt+← / Alt+→ move the focused block 5 min, with Shift 15; Enter
      saves, Esc cancels; the live region says the range and *Enter to save,
      Escape to cancel*.
- [ ] A tray item dragged onto the track previews at the pointer (centred on
      its length) and a drop writes its `started_at`/`ended_at`; the tray
      item is removed from the tray by the re-read.
- [ ] Hover tooltips, Fit folding, the lunch pill, day/night tint, the
      signals and agents lanes, the range drag (LAI-897) and ← → keep working
      at every zoom, both themes, 1440 and 1180px. `my-day-v3`,
      `my-day-timeline-zoom`, `my-day-range` re-aimed; new browser tests for
      a move, a resize, a refused move, a tray drop and Alt+arrow.

## Notes / context

Design: `docs/design/TimelineV2.dc.html` (`down`, `check`, `drop`, `bounce`,
`onExtOver/Drop`, `pvDown`, the timer block in `renderVals`). The drag label
and ghost colours are the design's `T.tipBg`, `T.accent`, `T.hl`. SPEC
§11.4.3. No new dependency.
