---
id: LAI-512
title: 'My day: the Timeline card as TimelineV2 draws it — one header row with the legend inline, no footer, Marks and Expand in the lane column, sun and moon on the hours, a running timer on the track, and blocks that move and resize by drag, tray items that drop onto the track, Alt+arrows that move a block'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: done
started: 2026-10-25T01:10:00Z
finished: 2026-10-25T08:28:07Z
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

- [x] Header, one row that wraps only when the card is narrow: *Timeline*,
      `Thu 22 Oct` in mono, the four legend items with a 16×12 swatch, the
      label and the figure in mono bold, compact (`2h 10m`, `35m`, as
      `timeline-core.js`'s `dur`); labels *Confirmed · Drafted · No task yet ·
      Gaps*; Gaps still opens the first gap. Right: the ‹ ● Now › group
      (30px, 9px radius) and the zoom group: Fit / 1× / 2× as the design's
      radio plus the − 1× ─●─ + stepper and slider kept beside it. No
      *scroll sideways* word; the axis note says *Idle hours folded* on Fit.
- [x] No footer under the track (the keys row and the no-set-time line go;
      the keys stay on the ? sheet, the tray says what has no set time).
- [ ] Lane column 148px: SIGNALS with Prompts, Commits and Marks rows
      (glyph, word, figure in mono); YOU with the mono 17px total and *of work
      · Xh Ym confirmed*; AGENTS with an Expand/Collapse button, `N agents ·
      Xh Ym`, and *Beside your day. Never added to your hours.* — nothing
      truncated at 1440. The row-height grip stays, under YOU.
- [x] Hour labels carry the design's sun (before 5 PM) and moon (6 PM on)
      icons; the card's radius is 16px; the now pill is red with the clock.
- [x] A running timer draws as the design's `S.timer` block at its start to
      now (striped accent), *LAI-867 · 42m · running* or *paused*, the now
      line at its end; clicking it opens the timer popover.
- [x] Drag: a drafted or confirmed block moves by its body and resizes by
      either 9px edge, on the 5-minute grid, with the design's floating label
      (`3:40–4:50 PM · 1h 10m`), a dashed ghost at the old place, and a red
      label + bounce back after 1.6s when the result would overlap confirmed
      time (`Overlaps LAI-860, 12:30–1:30 PM`) or cross midnight. A drop
      writes the moved edges (`started_at`/`ended_at` + `minutes`) through
      the existing update routes and says *Moved … to …* with Undo.
- [x] Alt+← / Alt+→ move the focused block 5 min, with Shift 15; Enter
      saves, Esc cancels; the live region says the range and *Enter to save,
      Escape to cancel*.
- [x] A tray item dragged onto the track previews at the pointer (centred on
      its length) and a drop writes its `started_at`/`ended_at`; the tray
      item is removed from the tray by the re-read.
- [x] Hover tooltips, Fit folding, the lunch pill, day/night tint, the
      signals and agents lanes, the range drag (LAI-897) and ← → keep working
      at every zoom, both themes, 1440 and 1180px. `my-day-v3`,
      `my-day-timeline-zoom`, `my-day-range` re-aimed; new browser tests for
      a move, a resize, a refused move, a tray drop and Alt+arrow.

## Notes / context

Design: `docs/design/TimelineV2.dc.html` (`down`, `check`, `drop`, `bounce`,
`onExtOver/Drop`, `pvDown`, the timer block in `renderVals`). The drag label
and ghost colours are the design's `T.tipBg`, `T.accent`, `T.hl`. SPEC
§11.4.3. No new dependency.

## Build notes

Finished 2026-10-25 from the previous builder's uncommitted work, in
`Laika-myday-512` on `LAI-512-timeline-v2`.

**Not met: the AGENTS Expand/Collapse button and `N agents · Xh Ym`.** The
server sends `agent.lane` as one series of five-minute buckets
(`[start, seconds, seconds on a card]`, LAI-833) with no agent identity. So
there is no count of agents to give and nothing to expand into. Drawing
either needs a CORE change that sends a lane per agent session first. The
column shows AGENTS with its figure on the head row, `X min on a card`, and
*Beside your day. Never added to your hours.*, none of it cut at 1440. The
rest of that criterion (SIGNALS with Marks, YOU, the grip) is met.

Where the build departs from the design on purpose:

- The agents figure stays in minutes however long (D-088 item 8), not `Xh Ym`.
- YOU's figure is 16px (`--text-heading-sm`): `type-floor.test.ts` allows
  token sizes only, and 17px is not one.
- Sun and moon follow D-106: sunrise and sunset at the person's place, not a
  fixed 5 PM and 6 PM. A zone with no place on the list draws no sky.
- The timer block's click moves focus to the header pill's pause, stop and
  discard. The design's `pop: 'timer'` renders only while no timer runs, so
  a running timer has no popover to open.
- Fit / 1× / 2× look like the design's radio but keep `aria-pressed`: the
  stepper can pick a level none of the three names.
- `my-day-timeline-zoom` and `my-day-range` pass unchanged; neither needed
  re-aiming.

Found and fixed on the way:

- An unselected block's end could not be dragged by its hover-revealed edge.
  The drag's first move cleared the hover, the edge unmounted with the
  pointer capture, and every later move landed on the track. The block in
  hand now keeps its edges. The resize test presses the handle, as a person
  does, and goes red without the fix.
- A move, Alt+arrow or tray drop past midnight was pinned to the day's edge.
  It is now refused with *Can't cross midnight* and goes back, as the
  design's `check` does. Unit-tested; no browser fixture reaches midnight.
- The AGENTS figure and on-card line were squeezed to 1px in an 80px lane,
  and the Marks row ran 10px past a 74px SIGNALS lane, while their text
  still read back whole. The lanes are now 92px and the design's 82px, and
  the header test fails on any cut or squeezed line in the column.

Outside this task: `person-day.test.ts` *"her own day draws every write
control"* fails on the claimed commit `d5070553` as well. It waits for the
editor drawer that LAI-511 closed on load, and LAI-511 did not re-aim it.

Gate, after the last edit (`server/web`):

```
npx tsc -p tsconfig.json --noEmit                         TSC 0
node --test test/*.test.ts test/routes/screens/my-day/*.test.ts \
  test/theme/*.test.ts                                     UNIT 0   425 pass, 0 fail
node --test <the eleven Timeline browser suites>           TESTS 0  93 pass, 0 fail
npx vitest run test/tooling/structure.test.ts  (server/)   STRUCT 0 20 pass
npx eslint <each changed file>                             0 for each
pnpm format:fix; npx prettier --check <changed files>      0
```

## Accepted (CHIEF, 2026-10-25)

Accepted with the lane column's AGENTS *Expand / Collapse* and *N agents* not met: the day view carries one merged lane and no agent identity. Filed as LAI-520 (server, then web). Released with the My day design merge on the owner's word after the local review ("perfect push everthing on master now").
