---
id: LAI-300
title: 'My day Timeline: one Time zoom slider, Fit day, and crowded stretches as groups that expand into lanes'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-860
status: in-progress
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
- [ ] The desktop Timeline has exactly three navigation controls besides
      ‹ Now ›: a range input labelled **Time zoom** (visible label and
      accessible name), a **Fit day** button, and one **Expand all / Collapse
      all** toggle (`aria-pressed` or `aria-expanded`, label follows state).
      The stepper, the Fit · 1× · 2× presets, the row-height slider and the
      row grip are gone. Every other product action stays where it is.
- [ ] One zoom state drives the slider, Fit day, the slider's own keys,
      pinch and Ctrl/Cmd + wheel. The slider's value always shows the current
      zoom; zoom is clamped to the existing range (Fit … 5×).
- [ ] Row height is automatic: the YOU row grows to hold its lanes and
      groups; the label column stays aligned with each lane (the signals and
      agents label tests keep passing).

Crowded stretches
- [ ] A stretch of overlapping blocks that cannot each get a readable lane
      (the threshold is a named constant in `timeline-derive.ts`, with a
      unit test) is drawn as one compact rounded **group**: a count ("6
      tasks") and a subtle preview of its bars at their true times, using
      existing tokens only (D-020).
- [ ] Clicking or Enter/Space on a group expands it in place into readable
      lanes inside the same timeline; an expanded group shows an obvious
      **Collapse** control. Several groups may be open at once; opening one
      never closes another.
- [ ] Expand all opens every group; Collapse all closes them. Neither
      changes the zoom or the scroll position's time.
- [ ] The Timeline's content grows taller when lanes need room and scrolls
      vertically inside its own box; lanes are never squeezed under a
      readable minimum. The time ruler stays visible while scrolling
      vertically and the row labels stay visible while scrolling sideways.
- [ ] Group identity is stable (derived from its blocks, not its index), so
      a reload or an edit elsewhere does not close an open group.

Short tasks and detail
- [ ] A block's drawn bar is exactly its start and duration at every zoom.
      A tiny block gets a hit target of at least 24px wide (transparent,
      centred on the bar) that does not draw past its bar; where two such
      targets would overlap, grouping or lanes resolve it.
- [ ] Title, duration and status appear progressively as width allows,
      never a lone letter (keep `FitLabel` / `cutsOf`). Every block's full
      detail stays reachable through selection and the inspector by pointer,
      touch and keyboard.

Zoom and navigation
- [ ] Plain trackpad scroll pans both axes; plain mouse wheel scrolls
      vertically; Shift + wheel pans horizontally; pinch or Ctrl/Cmd + wheel
      over the timeline zooms around the pointer's time. `preventDefault` is
      called only for gestures the timeline handles (zoom, and vertical
      scroll it can actually consume); at its scroll edges the page scrolls
      normally, and nothing outside the timeline changes behaviour
      (`my-day-page-scroll.test.ts` keeps passing).
- [ ] Slider zoom keeps the selected block's screen position when it is
      visible, otherwise the viewport centre's time. No jump on any zoom
      path; scroll is clamped.
- [ ] Fit day shows the whole day and collapses every group, without
      clearing the selection or changing any data.
- [ ] `prefers-reduced-motion: reduce` turns every smooth scroll and
      group/zoom transition into an instant one.

Drag and drop
- [ ] Move, resize, keyboard move/resize, tray drop, drag-to-create range,
      snapping, validation, read-only (another person's day), undo and error
      toasts behave exactly as before; the existing drag tests pass unchanged
      in meaning (selectors may follow the new controls).
- [ ] A drag is not a click: a drag never selects, expands or collapses a
      group.
- [ ] Pointer-to-time is correct at every zoom and scroll offset, including
      when the scroller scrolls during a drag (fix the "ignores scroll since
      pointer-down" mapping), and a tray drop computes its time from the drop
      event, not a stale preview.
- [ ] During an active drag the group layout is frozen, and zoom gestures
      (slider, pinch, Ctrl/Cmd + wheel, Fit day) are ignored until release,
      so a block cannot jump or save a wrong time. Auto-scroll at the
      scroller's edges during a drag, if added, keeps the mapping correct.

Tests
- [ ] Unit tests for the grouping derivation (thresholds, stable ids,
      expanded lanes, 1, 2, 4, 8, 12 at once, mixed durations, 5-minute
      blocks) and for zoom-around-a-time.
- [ ] Browser tests (Node test runner + Playwright, `server/web/test/browser/`)
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
- [ ] `my-day-timeline-zoom.test.ts`, `my-day-v3.test.ts` and
      `my-day-timeline-drag.test.ts` are updated only where they pinned the
      removed controls or the 8-at-once "no label" behaviour, and each such
      change is listed in this file with the reason.
- [ ] The phone view (≤900px, `TimelineMobile`) is not regressed:
      `my-day-phone.test.ts` passes. If the phone also gets the slider or
      groups, say so; if not, file it as a follow-up task.
- [ ] No design token or colour changes (D-020); any new `var(--x)` is
      timeline-local and defined; a new `.ts` module has its mirror test.
- [ ] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
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
