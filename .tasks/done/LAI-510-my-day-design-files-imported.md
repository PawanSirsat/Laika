---
id: LAI-510
title: 'docs/design carries the owner''s "Laika My Day" design — MyDay.dc.html, TimelineV2.dc.html, TimelineMobileV2.dc.html — and the README says what they are the reference for'
area: docs
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: done
started: 2026-10-25T00:20:00Z
finished: 2026-10-25T08:28:07Z
---

## Goal

The owner handed over `Laika My Day.html` on 2026-10-24 (a bundled export of
the Claude Design project *UI Reorganization and Simplification*,
`1af73506-d3bf-4636-807b-46695bf84eb4`) with the words *"go through this
prototype, click on everything, check the positions and responsiveness, then
match the design as it is"*. The source files behind that bundle are the
reference for LAI-511 to LAI-518, so `docs/design/` must carry them the way
it carries `Laika App v3.dc.html` for LAI-888: byte for byte as fetched from
the project, named in the README with what they are the reference for.

## Acceptance criteria

- [x] `docs/design/MyDay.dc.html`, `docs/design/TimelineV2.dc.html` and
      `docs/design/TimelineMobileV2.dc.html` are the project's files as
      fetched on 2026-10-25, byte for byte (the README records each etag).
- [x] `support.js` and `timeline-core.js` are unchanged (both equal to the
      project's copies; checksums equal).
- [x] `docs/design/README.md` gains a dated section naming the three files,
      the bundle they came from, the tasks they are the reference for
      (LAI-511 – LAI-518), and the design's own artifacts that are not to be
      copied: the Start timer and Viewing popovers clipped at the page's left
      edge at 1440px, and the week tiles truncating at 768px.

## Notes / context

CHIEF's own area. D-020 holds: nothing in `docs/design/` is edited, only
imported. The bundle itself (1.3 MB, fonts and React inlined) is not
imported; the three `.dc.html` files render over HTTP beside `support.js` and
`timeline-core.js`, as `Timeline.dc.html` does.

## Accepted (CHIEF, 2026-10-25)

All three met: the three files as fetched, `support.js` and `timeline-core.js` byte-equal, the README section (7647b5d2). Released with the My day design merge on the owner's word after the local review ("perfect push everthing on master now").
