---
id: LAI-513
title: 'My day: the header as designed — Confirm day with its mono figure, Fill gaps, the Who can see this popover, the eye badge, popovers that never clip — and the designed loading, error, time-tracking-off, empty, future and drafts-off cards'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: backlog
---

## Goal

Beside master on 2026-10-24 the design's header differs in five places and
its six page states each have a card master does not draw. The owner wants
the design as it is, including the three things D-110 item 11 had simplified
away (Fill gaps, the Who can see this popover; Assign task is LAI-514's).

## Acceptance criteria

- [ ] The confirm button always reads *Confirm day* with the mono sub
      `6 ready · 2 h 42 min` beside it (title: *N without a task stay in To
      review* when some have none); *Day confirmed* disabled when nothing is
      left to review; on a phone *Confirm 2 h 42 min*. The *Day note* button
      stays where the design has no drafts.
- [ ] *Fill gaps* — dashed accent border, `3 · 35 min` in mono — appears on
      today when gaps of 5 min or more lie before now; it opens the first gap
      in the editor and, after each add, the next, ending with *All gaps
      filled*.
- [ ] *Who can see this* opens the design's 320px popover (Drafts / Confirmed
      / Agent time rows and the Who looked line); the eye button carries the
      accent badge with the week's count of lookers.
- [ ] No popover is ever clipped by the page's edge: a popover whose anchor
      is within its width of the left edge anchors left instead (the design
      clips its Start timer and Viewing popovers at 1440; master does too —
      a defect in both, not to be copied).
- [ ] Loading: the Timeline skeleton card (*Timeline · Loading your day…*,
      the lane column block, three bars) and a second skeleton card, as drawn.
- [ ] Error: *Couldn't load Thursday*, the message, a Retry button, and the
      request line in mono (`GET /api/v1/me/time?day=… · 504`).
- [ ] Time tracking off for the organisation: the designed card with *Open
      Organisation settings* (routes to Organisation › Time tracking).
- [ ] Empty today, a future day, drafts off: the Timeline card with the
      date, tinted hour columns 7 AM–9 PM (day, dusk, night) and the centred
      card — *Nothing yet today* with Start timer / Add time; *Friday hasn't
      started* with Back to today; *Nothing drafted* with Turn drafting on /
      Add time — and the header total `0 min · nothing yet | not started`.
- [ ] The drafts-off banner and the read-only banner (blue, eye icon, *Back
      to my day*) as drawn; the viewing header shows only Viewing and ?.
- [ ] Both themes; `my-day-header`, `person-day`, `loading-sweep` re-aimed;
      a browser test per state.

## Notes / context

Design: `MyDay.dc.html` — `hd`, `pp.who`, `hd.hasGaps/fillGaps`, `bd.*`,
`emp`. D-110 item 11 is amended by the owner's 2026-10-25 instruction; CHIEF
records that in DECISIONS.md with the accept.
