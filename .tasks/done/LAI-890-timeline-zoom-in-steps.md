---
id: LAI-890
title: "My day Timeline: zoom in and out in steps, from half to five times, keeping the centre"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-889
status: done
started: 2026-10-22T12:54:12Z
finished: 2026-10-22T12:55:50Z
accepted: 2026-10-22T12:55:50Z
---

## Goal

The owner wants to set the Timeline's scale at their convenience rather than
pick one of Fit, 1× and 2×: a − / + stepper beside the three presets walks
0.5×, 0.75×, 1×, 1.5×, 2×, 3×, 4× and 5× of the design's 160px an hour, the
level shown between them, and the minute at the middle of the view stays
where it is as the scale changes.

## Acceptance criteria

- [x] − and + beside Fit · 1× · 2× step the scale through the eight levels;
      each end is disabled; the level between them reads `1.5×`, or *Fit*.
- [x] 1× and 2× light up when the stepped level equals them; from Fit, + goes
      to 1× and − does nothing.
- [x] Stepping keeps the minute at the middle of the scroller within a few
      minutes; a preset click behaves the same way; Fit still shows the whole
      day; today still opens at now at every level but Fit.
- [x] Unit tests for the step order and the px an hour at each level; the
      browser test clicks the stepper and measures the track.
- [x] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction in the temporary worktree
  `Laika-myday-zoom` on `LAI-890-timeline-zoom-steps`. Files under
  `server/web/src/routes/screens/my-day/` and their tests. No new dependencies.

## Record

- The My day browser files: 76 tests green on the branch. The second zoom
  group made the header 21px too wide at 390px; the nav now wraps and takes
  its own line on a phone.
- The repo-root gate was run once, on master after the merge.

