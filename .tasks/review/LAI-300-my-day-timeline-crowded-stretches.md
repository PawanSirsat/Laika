---
id: LAI-300
title: 'My day Timeline: one Time zoom slider, Fit day, and crowded stretches as groups that expand into lanes'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-860
status: review
finished: 2026-10-25T10:33:00Z
started: 2026-10-25T09:43:13Z
---

## Goal

LAI-860 made the YOU row's rule hold at any depth: blocks at the same time
take a row each, and a label, a count badge or an edge handle is drawn only
where it fits and clears its neighbours. **Past a certain depth and below a
certain width that rule leaves a block with nothing but its fill.** It can
still be told apart and clicked, and its details are in the inspector, but it
cannot be read on the lane. This task is the design decision for those two
cases, and then building it.

## Where LAI-860's rule stops (measured in Chrome, 2026-10-21)

**Down — rows by depth.** The row is 4.25rem (68px); a stack's rows share
68 − 10px, 2px apart, so each is `60 / n − 2` px:

| at once | row | what is drawn (hour-long blocks at 2×, 1440px) |
| --- | --- | --- |
| 1 | 58px | label, figures, badge, handles; not the card title |
| 2 | 28px | each label; the top row's badge; handles |
| 3 | 18px | each label (one 16px line); the top row's badge; no handles (under 20px) |
| 4 | 13px | the top row's badge; no labels (a 16px line does not fit) |
| 5 | 10px | the top row's badge, which ends just above row 2 |
| 6 | 8px | the blocks only: the top badge would reach 1px into row 2 |
| 7, 8 | 6.6, 5.5px | the blocks only |

Measured with a probe on stretches of one to eight at once. Of these the
browser test (`my-day-timeline-zoom.test.ts`) asserts the 3-at-once label at
1× and 2×, the 5-at-once top badge at 2×, and that eight at once draw no
label, badge or handle. A handle that is not drawn still takes Tab, ← and →.

**Across — too narrow to point at.** At Fit on a 390px window five minutes is
about 1.7px. Chrome hit-tests up to about 0.9px off the boxes it reports at
that width (measured on a block with nothing near it, with and without the
clip), so two five-minute blocks back to back cannot be told apart by a
pointer at all. LAI-860's test skips its "on top at its own centre" check for
a centre within 1px of a neighbour's box, and only there.

**The card title.** On a block with one row to itself, the key, the title
and the figures are three lines, and the body has room for two at the lane's
height, so the title is not drawn. On master before LAI-860 it was drawn and
clipped.

## Options (the owner's call; D-020: CHIEF and builders do not decide design)

- A cap: draw up to N rows and a `+N` marker for the rest, which opens a list.
- A taller YOU row when a day has a deep stack.
- Real lanes: one per card or project, so parallel work is side by side by
  design rather than squeezed into one row.
- A minimum drawn width at Fit (and on a phone), with blocks that would then
  overlap merged into one marker.

## Direction (the owner, 2026-10-25, D-113)

The owner picked the direction, on Belka, in their own words: *"Improve the
existing My Day timeline … using the minimal design we agreed on … Scope:
zoom, dense-task presentation, and group expansion only. Preserve every
existing feature."* It **amends D-112 item 2**: the zoom stepper, the
*Fit · 1× · 2×* presets and the row-height slider and grip go; one *Time
zoom* slider and a *Fit day* button stay. Of the four options above, the
answer is **groups that expand into lanes, with a taller row that scrolls**,
not a cap, not a minimum drawn width.

Code map (two read-only explorations of `076f4692`, this session): state in
`MyDayScreen.tsx:338` (`zoom`), `Timeline.tsx:375` (`blockPx`); scale is
`buildScale` (`timeline-derive.ts:708–767`), stacking is `stackOf`
(`:440–482`) and pure CSS rows (`timeline.css:1131–1143`, `--lane =
(--block-h + 2px) / --rows`); the "N at once" strip `Timeline.tsx:1663–1694`
selects its first block and expands nothing; `.dayline-scroller` is
`overflow-x: auto; overflow-y: hidden`; the axis is not sticky; there is no
wheel, pinch or auto-scroll handler and no `+`/`-`/`0` key today; a body drag
maps `scale.at(x(start) + clientX − downX)` and **ignores scroll since
pointer-down**; a tray drop commits the **last stored dragover preview**. The
phone view (≤900px) is `TimelineMobile.tsx`, vertical, with its own zoom.

## Acceptance criteria

Controls
- [x] The desktop Timeline has exactly three navigation controls besides
      ‹ Now ›: a range input labelled **Time zoom** (visible label and
      accessible name), a **Fit day** button, and one **Expand all / Collapse
      all** toggle (`aria-pressed` or `aria-expanded`, label follows state).
      The stepper, the Fit · 1× · 2× presets, the row-height slider and the
      row grip are gone. Every other product action stays where it is.
- [x] One zoom state drives the slider, Fit day, the slider's own keys,
      pinch and Ctrl/Cmd + wheel. The slider's value always shows the current
      zoom; zoom is clamped to the existing range (Fit … 5×).
- [x] Row height is automatic: the YOU row grows to hold its lanes and
      groups; the label column stays aligned with each lane (the signals and
      agents label tests keep passing).

Crowded stretches
- [x] A stretch of overlapping blocks that cannot each get a readable lane
      (the threshold is a named constant in `timeline-derive.ts`, with a
      unit test) is drawn as one compact rounded **group**: a count ("6
      tasks") and a subtle preview of its bars at their true times, using
      existing tokens only (D-020).
- [x] Clicking or Enter/Space on a group expands it in place into readable
      lanes inside the same timeline; an expanded group shows an obvious
      **Collapse** control. Several groups may be open at once; opening one
      never closes another.
- [x] Expand all opens every group; Collapse all closes them. Neither
      changes the zoom or the scroll position's time.
- [x] The Timeline's content grows taller when lanes need room and scrolls
      vertically inside its own box; lanes are never squeezed under a
      readable minimum. The time ruler stays visible while scrolling
      vertically and the row labels stay visible while scrolling sideways.
- [x] Group identity is stable (derived from its blocks, not its index), so
      a reload or an edit elsewhere does not close an open group.

Short tasks and detail
- [x] A block's drawn bar is exactly its start and duration at every zoom.
      A tiny block gets a hit target of at least 24px wide (transparent,
      centred on the bar) that does not draw past its bar; where two such
      targets would overlap, grouping or lanes resolve it.
- [x] Title, duration and status appear progressively as width allows,
      never a lone letter (keep `FitLabel` / `cutsOf`). Every block's full
      detail stays reachable through selection and the inspector by pointer,
      touch and keyboard.

Zoom and navigation
- [x] Plain trackpad scroll pans both axes; plain mouse wheel scrolls
      vertically; Shift + wheel pans horizontally; pinch or Ctrl/Cmd + wheel
      over the timeline zooms around the pointer's time. `preventDefault` is
      called only for gestures the timeline handles (zoom, and vertical
      scroll it can actually consume); at its scroll edges the page scrolls
      normally, and nothing outside the timeline changes behaviour
      (`my-day-page-scroll.test.ts` keeps passing).
- [x] Slider zoom keeps the selected block's screen position when it is
      visible, otherwise the viewport centre's time. No jump on any zoom
      path; scroll is clamped.
- [x] Fit day shows the whole day and collapses every group, without
      clearing the selection or changing any data.
- [x] `prefers-reduced-motion: reduce` turns every smooth scroll and
      group/zoom transition into an instant one.

Drag and drop
- [x] Move, resize, keyboard move/resize, tray drop, drag-to-create range,
      snapping, validation, read-only (another person's day), undo and error
      toasts behave exactly as before; the existing drag tests pass unchanged
      in meaning (selectors may follow the new controls).
- [x] A drag is not a click: a drag never selects, expands or collapses a
      group.
- [x] Pointer-to-time is correct at every zoom and scroll offset, including
      when the scroller scrolls during a drag (fix the "ignores scroll since
      pointer-down" mapping), and a tray drop computes its time from the drop
      event, not a stale preview.
- [x] During an active drag the group layout is frozen, and zoom gestures
      (slider, pinch, Ctrl/Cmd + wheel, Fit day) are ignored until release,
      so a block cannot jump or save a wrong time. Auto-scroll at the
      scroller's edges during a drag, if added, keeps the mapping correct.

Tests
- [x] Unit tests for the grouping derivation (thresholds, stable ids,
      expanded lanes, 1, 2, 4, 8, 12 at once, mixed durations, 5-minute
      blocks) and for zoom-around-a-time.
- [x] Browser tests (Node test runner + Playwright, `server/web/test/browser/`)
      on a sparse day and a crowded day with 12 simultaneous blocks, at
      1440 and 901 wide and both themes: groups render with a count; click
      expands, a second group expands while the first stays open; Expand all
      / Collapse all; nothing overlaps another block's box in expanded lanes;
      ruler stays visible after vertical scroll; Ctrl + wheel zooms around
      the pointer time (minute under the pointer moves < 2 minutes); Shift +
      wheel pans; a plain wheel at the timeline's bottom edge scrolls the
      page; a drag at 2 zoom levels and a non-zero scroll saves the expected
      times; a drag does not toggle a group; **no write request is sent and
      the day's totals are unchanged by any zoom, expand, collapse or Fit**.
- [x] `my-day-timeline-zoom.test.ts`, `my-day-v3.test.ts` and
      `my-day-timeline-drag.test.ts` are updated only where they pinned the
      removed controls or the 8-at-once "no label" behaviour, and each such
      change is listed in this file with the reason.
- [x] The phone view (≤900px, `TimelineMobile`) is not regressed:
      `my-day-phone.test.ts` passes. If the phone also gets the slider or
      groups, say so; if not, file it as a follow-up task.
- [x] No design token or colour changes (D-020); any new `var(--x)` is
      timeline-local and defined; a new `.ts` module has its mirror test.
- [x] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
      each redirected to its own file and its exit code captured on its own
      line.

## Notes

- Same files as LAI-860 and LAI-834 (`Timeline.tsx`, `timeline-derive.ts`,
  `my-day.css`). LAI-834's SIGNALS lane sits above the row and has the same
  across problem at Fit (its notes in LAI-860's review section).
- Filed by Strelka from Strelka's id block (LAI-300–399, D-097).
- Owner-direct (2026-10-25), dispatched by CHIEF (Belka). Branch
  `LAI-300-my-day-timeline-groups`, worktree `../Laika-300`. Seed any local
  instance on port 3477 with its own database (§4.3); no owner data.

## Review notes (the builder, 2026-10-25)

Built by a builder CHIEF (Belka) dispatched, on `LAI-300-my-day-timeline-groups`
in `../Laika-300`. Board card LAIKA-691.

### What changed

- `server/web/src/routes/screens/my-day/timeline-derive.ts`: `Zoom` is now
  `'fit' | number`, a multiple of 160px an hour. Added `pxPerHour`,
  `zoomFloor`, `clampZoom`, the slider's units (`sliderMin`, `sliderMax`,
  `sliderValue`, `zoomOfSlider`; a hundredth of a doubling, so 1× is 0 and
  2× is 100), `zoomStep` (walks `ZOOM_STEPS` from any multiple), `zoomLabel`.
  The layout constants are `BLOCK_PX`, `LANE_GAP_PX`, `LANE_MIN_PX` (24),
  `OPEN_LANE_PX` (28), `ROW_LANES` (3, derived from the minimum: **the
  threshold**) and `HIT_MIN_PX` (24). `layoutRow` lays out the YOU row:
  - Blocks **clash** if they overlap in time, or if both are drawn under
    24px and their targets overlap.
  - Clashing blocks form a stretch, and each block takes the first lane free
    of clashes.
  - A stretch of up to `ROW_LANES` lanes shares the row, as LAI-860 drew it.
    A deeper stretch is a group, with a stable id from its first block.
  - An open group's lanes grow the row.
  - A narrow block's target is held off whatever is drawn beside it.

  Also added: `keepAt` (zoom around a time) and `wheelAction` (what a wheel
  does). Removed `PX_PER_HOUR` and the grip's `BLOCK_MIN/MAX/STEP_PX` and
  `clampBlockHeight`.
- `server/web/src/routes/screens/my-day/Timeline.tsx`, header: the labelled
  *Time zoom* range, *Fit day* and one *Expand all / Collapse all* toggle
  (`aria-expanded`, its words follow its state). The stepper, the presets,
  the row-height slider and the grip are gone.
- `Timeline.tsx`, zoom: one zoom path (`zoomTo`) for the slider, its keys
  (←/→/PgUp/PgDn walk the steps, Home is Fit, End is 5×), Fit day, Ctrl/Cmd
  + wheel and pinch. Pinch arrives as a Ctrl wheel, or as Safari's
  `gesture*` events. Each path keeps its anchor minute on screen in a layout
  effect. The wheel and gesture listeners are non-passive, on the lanes' box.
  `preventDefault` is called only for a zoom, or for a Shift + wheel pan
  while the track has room; everything else is the browser's own. A pinch's
  events in one frame make one zoom.
- `Timeline.tsx`, groups: a closed group has its count and a faint bar for
  each block. An open group has a frame and a *Collapse* where the strip
  would be. The keyboard moves to Collapse and back, `preventScroll`. Which
  groups are open is kept per day in sessionStorage. Picking a block that is
  in a closed group opens that group (not on the page's own first
  selection). The group holding the selection is ringed.
- `Timeline.tsx`, narrow blocks: each gets a transparent `.dayline-hit`
  target. The row's range drag now leaves that target to the block.
- `Timeline.tsx`, drag:
  - A body drag counts px along the track, so a scroll since pointer-down
    counts.
  - A scroll mid-drag moves the block in hand, or the range being drawn, as
    a pointer move would.
  - A tray drop takes its time from the drop event.
  - While anything is in hand, zoom, Fit day and group toggles do nothing.
    The layout is computed from the blocks as they are, so it cannot
    reshuffle under the pointer.
  - *Now* scrolls instantly under `prefers-reduced-motion`.
  - The tooltip moved to the card, so the lanes' scroll box cannot clip it.
- `server/web/src/routes/screens/my-day/timeline.css`:
  - New styles for the controls, the group, its frame, Collapse and the hit
    target.
  - `.dayline-grid` scrolls down past `min(26rem, 62vh)`. The ruler, the
    column's corner, the break pills and the now pill move by `--ruler-y`
    (timeline-local, defined on `.dayline-grid`) and turn solid while
    scrolled.
  - Blocks and bites are placed inline.
  - Added a reduced-motion block.
  - Removed the stepper, preset, grip and row-height styles.
  - No token or colour changed (D-020).
- `server/web/src/routes/screens/my-day/my-day.css`: the focus ring list
  names the group and Collapse in place of the presets.
- `server/web/src/routes/screens/my-day/MyDayScreen.tsx`: the zoom state
  starts at `1`, a number.

### Tests

- **New** `server/web/test/browser/my-day-timeline-groups.test.ts`, 7 test
  cases:
  - A crowded day (12 at once, plus 5 at once) at 1440 and 901, light and
    dark: counts and bars; a click opens one group, and a second leaves the
    first open; no overlap, lanes ≥ 24px, the column follows the row;
    Collapse; Expand all and Collapse all with no zoom or scroll change;
    Enter and Space from the keyboard; Fit day closes all and keeps the
    selection; **no non-GET request and the totals unchanged**.
  - A sparse day at both widths and themes: no group, Expand all disabled,
    exactly the three controls, and reduced motion makes Now instant.
  - At 1440 and 901: the ruler and the column's corner stay at the top
    after a vertical scroll; the column stays put sideways; at the lanes'
    bottom a plain wheel scrolls the page.
  - At 1440 and 901: Ctrl + wheel in and out keeps the minute under the
    pointer within 2 minutes; Shift + wheel pans.
  - Drags: at 1× and at 2× from a scrolled track, with exact PATCH bodies;
    Ctrl + wheel mid-drag does not zoom; a 60-minute scroll mid-drag lands
    60 minutes later; dragging a closed group or an open group's Collapse
    toggles nothing; an open group survives three writes and a page reload.
- **New helper** `server/web/test/browser/my-day-zoom.ts`: `zoomTo`, which
  sets Fit by the button and a multiple by the slider.
- **Unit** `server/web/test/routes/screens/my-day/timeline-derive.test.ts`:
  - The `zoomStep`/`PX_PER_HOUR` describe was replaced, because that API is
    gone.
  - Added the scale, `keepAt` (zoom around a time), `wheelAction`, and
    `layoutRow`: the threshold; 1, 2, 4, 8 and 12 at once; mixed lengths;
    5-minute blocks at 1× and 2×; narrow targets; stable ids under shuffle
    and edits elsewhere; several open at once.
  - `axisHours` and `buildScale` calls take numbers.
- **Mutation-checked**: each of the following was broken on purpose and its
  assertion went red, then put back. The browser cases: drag on a group
  counted as a click, zoom anchor dropped, one group at a time, scroll
  mid-drag not followed, zoom allowed mid-drag (both guards), smooth Now
  under reduced motion. The unit cases: threshold, narrow-target clash,
  group id from its index.
- **Changed existing tests, and why:**
  - `my-day-timeline-zoom.test.ts`: the preset click became `zoomTo`. It
    clicks *Expand all* before measuring, because a closed group draws no
    blocks. The eight-at-once "draws no label, no chip, no edges" check
    became "in a group: no chip, a label at 1× and 2×, and g8 draws its
    edges". The floor for f1–f5 and g1–g8 is the 24px lane minimum instead
    of 3px.
  - `my-day-v3.test.ts`: "− and + step the scale" became "the Time zoom
    slider walks the scale by its keys", with the same levels, widths and
    middle-kept assertion, and Fit as the least value. "The slider sets the
    scale, and the grip drags the rows taller" became "the row is as tall as
    it needs, no grip, no row slider, the column rule for rule" (122 and
    80px kept). New: "the slider keeps a selected block where it is on
    screen". The Fit test's preset clicks became `zoomTo`.
  - `my-day-timeline-drag.test.ts`: the zoom-controls assertion is now
    D-113's set (the slider by its accessible name, then `Fit day` and
    `Expand all`, and no stepper, preset, row slider or grip). The preset
    click became `zoomTo`.
  - `my-day-daylight.test.ts`, `my-day-range.test.ts`, `org-breaks.test.ts`
    and `my-day-v2.test.ts`: only `[data-zoom="1|2"]` clicks became
    `zoomTo(page, 1|2)`, a selector following the new control. Nothing they
    assert changed.
- Unchanged and passing: `my-day-phone`, `my-day-signals`, `my-day-agents`,
  `my-day-page-scroll`, `person-day`.

### Gate

Repo root, each redirected to its own file, each exit code on its own line:
`pnpm test` → 0 (server vitest: 3897 tests passed, 10 skipped; web: 3376
test cases passed, 0 failed); `pnpm lint` → 1 on the first run, for one
`prefer-string-starts-ends-with` in the new test, fixed in `f1bc4880`, then
0; `pnpm format` → 0. The full gate is run again after this file's edit,
and the PR carries that run's three exit codes.

### Decisions

- The threshold of 3 keeps LAI-860's three-at-once labels in the row, which
  its test asserts. A group starts at four.
- The lane column and the track scroll down together natively in one box. So
  that the column stays outside the sideways scroll, the horizontal scroller
  stays separate. Sticky cannot reach through it, so the ruler is held by a
  transform from the box's scroll.
- The level readout beside the slider was dropped so the header keeps one
  row at 1440 (measured: the nav is 419px, the old stepper and presets were
  about 418px). The level shows in the thumb, in `aria-valuetext` and in
  the label's title.
- **Phone not changed:** filed LAI-523 (`LAI-950` – `LAI-999` was full when
  the §3 sweep ran, so the id is from CHIEF's D-109 block).
- Belka's LAI-860 review comment on where the folder name lives is outside
  D-113's scope ("zoom, dense-task presentation, and group expansion only").
  Not built.

### Only a real device can verify

- Trackpad pinch in Chrome or Edge (a Ctrl wheel) and in Safari
  (`gesturestart`/`gesturechange`). No test exercises Safari's gesture
  events: Playwright's Chromium has none.
- Trackpad two-axis pan. Sideways is the track's scroller and down is the
  lanes' box, so the browser latches a diagonal gesture to the axis it
  starts on. Check the feel on a Mac trackpad.
- Whether the ruler visibly lags a fast or momentum scroll. It follows a CSS
  variable set on scroll, not `position: sticky`.
- With groups open and the lanes scrolled up, the sideways scrollbar is at
  the bottom of the lanes' box, out of view. Shift + wheel and a trackpad
  still pan.
- Touch on a touchscreen laptop at 901px and wider: the 24px targets and the
  group taps.

