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

## Review notes — round 1 (cross-review of PR #284 at 6af93a74: BLOCK)

**B1, fixed on polly's decision.** `GET /people/:id/load` fired on every
profile tab, logging a `time` look on Day and Time report, which never draw
it. Current load is now **collapsed** on Overview as *Show current load ·
<name> can see you looked*; the load is read only on that click, never on
opening the profile or any tab; someone else's header pill comes from that
read and is absent until then. **This deviates from frame 2f** (which draws
the card open) on polly's decision, for privacy consistency with D-102 and
LAI-1138's *Time this week*. SPEC §11.4.2 / §11.4.2.1 reworded to match.
Gated on `readsDays && me.id !== user.id`, not on `tabbed`, so LAI-1140's
`tabbed = offered.length > 1` (PR #285) cannot show it to a reader without
analytics.

**Also fixed:** (1) moving the away date adds the new period before deleting
the old; (3) every My availability shares one record; (4) SPEC: *updated N
ago* only where the server sends it; (6) a space admin's Space filter lists
only the spaces they lead; (7) the Time tab's inset moved to
`insights/time-tab.css`. **Left as is, per review:** item 5 (the header copy
for space admins), raised with the owner by polly.

**Tests added:** zero `/people/u2/load` reads on `?tab=overview`, `day` and
`time`, exactly one on *Show current load* (an eager-read mutant fails all
five); a reader with profiles but no analytics sees no Current load and
reads none; *Away until…*, a date move (add, then delete) and a refused move
(no delete); a failed mark keeps the count; `task_not_assignable`; the lead's
Space filter; neither popover nor For you on somebody else's day.

## Review notes — round 2 (B1 passes; R1 BLOCK → fixed)

**R1 / N2:** the shared availability record and the unread count were module
state that outlived a sign-out, so the next person on the tab could see (and
Save over) the last one's. `setStoreUser` now resets both alongside the other
per-user stores, and a generation counter drops any read or save begun for
the previous person. **N1:** moving to another profile closes Current load;
A → Show → B → A is collapsed with no second `/load`. **N3:** no change; the
20-period trade-off is in the log. Merged `origin/master` after LAI-1140
(#285): Current load gates on `offered.includes('time')`, never `tabbed`.
