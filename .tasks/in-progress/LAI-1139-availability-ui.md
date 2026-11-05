---
id: LAI-1139
title: 'Availability UI: My day pill and popover, For you notices, Insights → Time → Availability with Add to project, profile Current load and pill'
area: web
assignee: shell/belka
priority: p2
depends-on: [LAI-1130, LAI-1136, LAI-1134, LAI-1138]
status: in-progress
started: 2026-11-05T17:10:00+05:30
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

- [ ] Frames 2a–2l and 2n–2o in both themes and at 390px; frame 2m (free
      hours) is absent.
- [ ] The popover saves through `PUT /me/availability`, shows `422`s inline
      and *updated N ago*.
- [ ] The pill is glyph plus text (not colour alone).
- [ ] The Availability table is A–Z, the filters work, and the hours column
      appears only when the server sent it.
- [ ] A lead sees only their spaces in Add to project.
- [ ] The Add dialog posts once with message and card, then shows *✓ Added…*.
- [ ] `409` and `422` (including `user_deactivated`) are handled.
- [ ] The For you card lists notices with read and read-all, the message is
      plain text, and My day's nav item carries the unread count.
- [ ] Current load shows the two working-week numbers as text on a neutral
      track with no fill proportion; no computed free hours anywhere.
- [ ] Empty states are worded as in the design.
- [ ] A member never sees load figures (asserted against a member session).
- [ ] Deactivated people are not listed in Availability.
