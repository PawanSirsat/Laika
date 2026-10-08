---
id: LAI-731
title: 'Timeline: drag a sprint bar''s edge to reschedule it, rejected on overlap'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-721
status: backlog
---

## Goal

SPEC §11.4.2.1 requires the Timeline to let a lead drag a sprint's edge to
reschedule it, with overlap rejected; §11.4.3 lists it as not built. LAI-721
rebuilt the Timeline as one row per sprint on a scrolling, zoomable axis
(D-074) and left this out of scope.

## Acceptance criteria

- [ ] A lead (or above) can drag either end of a sprint's bar; the bar follows
      the pointer snapped to whole days at the current zoom.
- [ ] Dropping sends `PATCH /api/v1/sprints/:id` with `starts_on` / `ends_on`;
      the bar moves only when the server answers, as the board's moves do.
- [ ] A drag that would overlap a neighbour is refused by the server (§4.15)
      and the bar returns, with the server's message shown — asserted in a
      browser test.
- [ ] Below lead the edges are not draggable — absent, not disabled (LAI-082).
- [ ] Keyboard: a focused edge moves a day with the arrow keys and commits on
      Enter, so the action is not pointer-only.

## Notes / context

- `server/web/src/routes/screens/timeline/TimelineScreen.tsx` draws the bars;
  positions are `sprintSpan` × `DAY_WIDTH[zoom]` (`timeline-derive.ts`).
- Dragging an unscheduled task into a sprint (also in §11.4.3) is separate.
