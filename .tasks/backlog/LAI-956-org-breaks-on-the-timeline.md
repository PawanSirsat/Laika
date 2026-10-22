---
id: LAI-956
title: 'My day''s Timeline does not show the organisation''s lunch and other breaks, and an owner has nowhere to set them'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-955]
discovered-from:
status: backlog
---

## Goal

D-101, web half: an owner or admin edits the organisation's break windows on
the Organisation screen, and every person's My day Timeline shows them.

## Acceptance criteria

- [ ] Client `TimeSettings` in `api/time.ts` mirrors `breaks` (the
      view-type drift check is green) and a `setOrgBreaks` call for
      `PUT /org/time/breaks`.
- [ ] Organisation screen, beside the Time setting (`TimeModeFact.tsx` or a
      sibling): owners and admins see an editor — add / edit / remove a
      window: label, start, end, weekdays — with the server's `422` message
      shown on the window it names. Other roles see the schedule read-only (or
      nothing when empty). Saving sends the whole list.
- [ ] My day Timeline: each window whose weekday matches the viewed day is a
      shaded, labelled band on the You lane, behind blocks, not clickable,
      built from the day's own zone (existing `atClock`). Blocks over it stay
      fully visible and selectable.
- [ ] `gapsOf` treats scheduled windows like the person's own breaks (cut out
      of gaps; the 20-minute and before-first/after-last rules unchanged) and
      the axis range includes them — unit tests in `timeline-derive`.
- [ ] Nothing compares the day against the schedule (D-101 item 4): no
      wording, badge or count about time worked in a window.
- [ ] Browser test with a pinned clock (LAI-954's helper if landed): band
      drawn with its label on a matching weekday, absent on a non-matching
      one; editor round-trip as owner; member sees no editor. Light and dark,
      1440 and 390.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 on a branch
      with LAI-955 merged in (§4.4 step 4).
