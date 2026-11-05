---
id: LAI-1134
title: 'Member profile simplified: header with ⋯, tabs, the Manage member panel'
area: web
assignee: shell/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T15:05:00+05:30
finished: 2026-11-05T15:25:00+05:30
---

## Why

Programme plan T6 (`.polly/plans/time-report-programme.md`, design
`.polly/designs/laika-time-report.html` frames 1n–1s). Today every admin
control on a member profile is an inline Admin card above the record, and the
Builder/Manager control sits in the header. The design gives the profile a
plain header with a **⋯** menu, tabs **Overview · Day · Time report ·
Developer setup**, and moves every admin control into a right-side **Manage
member** panel (a bottom sheet on a phone). No new data: the Time report tab
shows today's Hours content until LAI-1138, and Developer setup stays hidden until
LAI-1140 ships its endpoint. Board card: LAIKA-995, a subtask of LAIKA-997.

## Acceptance criteria

- [x] The header carries name, kind chip, role · projects · email · member
      since, and a **⋯** menu button named *Manage <name>* that opens a
      `menu` with a *Manage member…* item, keyboard-operable.
- [x] *Manage member…* opens a dialog (`aria-modal`, labelled by its title):
      focus moves in, Tab is trapped, Escape and the close button close it
      and return focus to ⋯. A desktop right-hand panel, a phone bottom sheet.
- [x] The panel draws only the sections the server grants
      (`adminControls()`): Role (organisation role and profile kind), Spaces,
      Tokens (the full list, until LAI-1140), Security (reset link, sign out
      everywhere), Danger zone (deactivate / reactivate). With none, no ⋯.
- [x] Every existing admin action still works from the panel: role change,
      profile kind, spaces add/remove, token revoke, reset link, sign out
      everywhere, deactivate (offboarding dialog) and reactivate.
- [x] Tabs Overview · Day · Time report; `?tab=time` shows the Hours
      content and `?tab=hours` still opens it. Developer setup is not drawn
      until its endpoint exists. Your own profile has no tabs, as today.
- [x] Overview: the design's cards first, Activity, then the SPEC
      must-haves — Delivered, Tokens usage, Admin's rating, Recent decisions
      — folded below, none removed. The Day tab is unchanged.
- [x] Both themes, 1440 and 390, nothing scrolling sideways.
- [x] Existing admin-panel and profile browser tests re-aimed at the panel,
      not deleted; new browser tests for the panel and the tabs.
- [x] SPEC §11.4.2.1 *Member profile* names the header ⋯, the Manage member
      panel and the tabs (the only `docs/` edit).

## Notes / context

- Web only: `server/web/**`, plus the SPEC §11.4.2.1 crossing named above.
- *Time this week* and *Current load* (frames 1n–1p) are not built here:
  Current load needs the availability task's data (plan T2), and Time this week would read a member's
  hours on every Overview open, which logs a view — it belongs with LAI-1138's
  TimeReport.

## Deviations from the design (frames 1n–1s)

- **No *Time this week* or *Current load* card.** Current load needs the
  availability data; Time this week would read a member's hours on every
  Overview open, which logs a view, so it belongs with LAI-1138.
- **Tokens in the panel is the full list, not a count and a link** — the plan
  keeps it until LAI-1140 gives it a home.
- **Current work sits in the summary columns with Agents, Review and
  Projects**, above Activity, not in a row with Time this week.
- **The header's *owners and admins only* pill is gone**; the screen header
  already says it. No availability pill or note/tags (later tasks).
- **Pickers are the app's `Dropdown`, not native `<select>`**, as everywhere
  else.
- ⋯ opens a `menu` with one item, *Manage member…*, then the panel — the
  design's ⋯ opens the panel directly; the plan asked for a menu button.
