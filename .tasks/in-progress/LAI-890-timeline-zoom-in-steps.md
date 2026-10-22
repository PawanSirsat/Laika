---
id: LAI-890
title: "My day Timeline: zoom in and out in steps, from half to five times, keeping the centre"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-889
status: in-progress
started: 2026-10-22T12:54:12Z
---

## Goal

The owner wants to set the Timeline's scale at their convenience rather than
pick one of Fit, 1× and 2×: a − / + stepper beside the three presets walks
0.5×, 0.75×, 1×, 1.5×, 2×, 3×, 4× and 5× of the design's 160px an hour, the
level shown between them, and the minute at the middle of the view stays
where it is as the scale changes.

## Acceptance criteria

- [ ] − and + beside Fit · 1× · 2× step the scale through the eight levels;
      each end is disabled; the level between them reads `1.5×`, or *Fit*.
- [ ] 1× and 2× light up when the stepped level equals them; from Fit, + goes
      to 1× and − does nothing.
- [ ] Stepping keeps the minute at the middle of the scroller within a few
      minutes; a preset click behaves the same way; Fit still shows the whole
      day; today still opens at now at every level but Fit.
- [ ] Unit tests for the step order and the px an hour at each level; the
      browser test clicks the stepper and measures the track.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction in the temporary worktree
  `Laika-myday-zoom` on `LAI-890-timeline-zoom-steps`. Files under
  `server/web/src/routes/screens/my-day/` and their tests. No new dependencies.
