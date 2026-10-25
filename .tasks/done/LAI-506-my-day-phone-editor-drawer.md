---
id: LAI-506
title: 'My day on a phone: the editor is a bottom drawer'
area: web
assignee: chief
priority: p1
depends-on: [LAI-504]
discovered-from: LAI-897
status: done
started: 2026-10-25T08:28:07Z
finished: 2026-10-25T08:28:07Z
---

## Goal

D-110 item 10: under 34rem the editor renders in a bottom sheet — dialog role,
focus trapped, Esc and a handle close it; a selection opens it, letting go closes
it. Desktop keeps the side panel.

## Acceptance criteria

- [ ] At 390px a selected block opens the drawer with the entry's words; Esc closes it; both themes.
- [ ] Container query, not a media query; no desktop layout change.

## Notes / context

D-110.

## Superseded (CHIEF, 2026-10-25)

Never built as written. LAI-511 made the editor a drawer on the right that becomes a bottom sheet on a phone, and LAI-518 built the design's phone page around it. Closed so nobody claims it.
