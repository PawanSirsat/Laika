---
id: LAI-1139
title: 'Availability UI: My day pill and popover, For you notices, Insights → Time → Availability with Add to project, profile Current load and pill'
area: web
assignee: shell/belka
priority: p2
depends-on: [LAI-1130, LAI-1136, LAI-1134, LAI-1138]
status: review
started: 2026-11-05T17:10:00+05:30
finished: 2026-11-05T18:40:00+05:30
---

## Why

T7 of `.polly/plans/time-report-programme.md` (§1 frames 2a–2l, 2n–2o, §2.2,
§2.3, §4 T7). D-131, D-134, D-137 (visibility tiers), D-088 (no ranking, no
utilisation). Card LAIKA-1002, a subtask of LAIKA-997 (LAI-1133).

**Deviation (§2 step 1):** LAI-1130, LAI-1136 and LAI-1134 are merged into
`master` and sit in `.tasks/review/` there; LAI-1138 (PR #281) is not merged.
Polly directed the claim. The Insights → Time → Availability sub-tab is built
only once #281 lands, or against its branch shape.

## Named crossings

- `docs/SPEC.md` §11.4.2 and §11.4.2.1 rows for My day, Insights and the
  member profile.
- `server/web/test/api/endpoint-coverage.test.ts` `NO_BROWSER_CALLER`: the
  entries for the endpoints this task now calls are removed.

## Acceptance criteria

- [x] Frames 2a–2l and 2n–2o in both themes and at 390px; frame 2m (free
      hours) is absent.
- [x] The popover saves through `PUT /me/availability`, shows `422`s inline
      and *updated N ago*.
- [x] The pill is glyph plus text (not colour alone).
- [x] The Availability table is A–Z, the filters work, and the hours column
      appears only when the server sent it.
- [x] A lead sees only their spaces in Add to project.
- [x] The Add dialog posts once with message and card, then shows *✓ Added…*.
- [x] `409` and `422` (including `user_deactivated`) are handled.
- [x] The For you card lists notices with read and read-all, the message is
      plain text, and My day's nav item carries the unread count.
- [x] Current load shows the two working-week numbers as text on a neutral
      track with no fill proportion; no computed free hours anywhere.
- [x] Empty states are worded as in the design.
- [x] A member never sees load figures (asserted against a member session).
- [x] Deactivated people are not listed in Availability.

## Delivered

PR #284. Insights → Time → Availability is built on LAI-1138's Time tab
(#281, merged mid-task and merged in here). Frame 2m is absent; Current
load is a full-width card above the profile summary rather than a grid
cell. Follow-up: LAI-1145 (pair the client types; two owners). Log:
`logs/shell-2026-11-05-LAI-1139.md`.
