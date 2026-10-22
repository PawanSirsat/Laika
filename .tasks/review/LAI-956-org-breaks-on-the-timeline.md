---
id: LAI-956
title: 'My day''s Timeline does not show the organisation''s lunch and other breaks, and an owner has nowhere to set them'
area: web
assignee: shell
priority: p2
depends-on: [LAI-955]
discovered-from:
status: review
started: 2026-10-22T13:58:59Z
finished: 2026-10-22T14:12:19Z
---

## Goal

D-101, web half: an owner or admin edits the organisation's break windows on
the Organisation screen, and every person's My day Timeline shows them.

## Acceptance criteria

- [x] Client `TimeSettings` in `api/time.ts` mirrors `breaks` (the
      view-type drift check is green) and a `setOrgBreaks` call for
      `PUT /org/time/breaks`.
- [x] Organisation screen, beside the Time setting (`TimeModeFact.tsx` or a
      sibling): owners and admins see an editor — add / edit / remove a
      window: label, start, end, weekdays — with the server's `422` message
      shown on the window it names. Other roles see the schedule read-only (or
      nothing when empty). Saving sends the whole list.
- [x] My day Timeline: each window whose weekday matches the viewed day is a
      shaded, labelled band on the You lane, behind blocks, not clickable,
      built from the day's own zone (existing `atClock`). Blocks over it stay
      fully visible and selectable.
- [x] `gapsOf` treats scheduled windows like the person's own breaks (cut out
      of gaps; the 20-minute and before-first/after-last rules unchanged) and
      the axis range includes them — unit tests in `timeline-derive`.
- [x] Nothing compares the day against the schedule (D-101 item 4): no
      wording, badge or count about time worked in a window.
- [x] Browser test with a pinned clock (LAI-954's helper if landed): band
      drawn with its label on a matching weekday, absent on a non-matching
      one; editor round-trip as owner; member sees no editor. Light and dark,
      1440 and 390.
- [x] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 on a branch
      with LAI-955 merged in (§4.4 step 4).

## Submitted (SHELL, 2026-10-22)

On `LAI-956-org-breaks-on-the-timeline`, built on
`origin/LAI-955-org-break-schedule-api` @868a2b01 with LAI-954 merged
(0d0c8761). Both red web checks LAI-955 left are green: view-type-drift
`TimeSettingsView.breaks` and endpoint-coverage `api/v1/org/time/breaks`.
Gate after the last code edit: `pnpm test` 0, `pnpm lint` 0, `pnpm format` 0.
