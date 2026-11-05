---
id: LAI-1152
title: 'Profile shell: breadcrumb, head card with availability pill, ⋯ menu, Who looked, tabs on your own profile'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-1150]
status: backlog
---

## Goal

The profile's frame as the design draws it (frames A, C and the Who looked
popover), for someone else and for your own, with D-139 item 8's removals.

## Acceptance criteria

- [ ] Breadcrumb *Members / <name>* or *My profile*, and the top-right notice in
      the two wordings of SPEC §11.4.2.1.
- [ ] Head card: avatar ring, name, kind chip, the availability pill inline —
      including a dashed *Availability not set* — meta line, and the note /
      tags / *set by … · updated …* line (*set by you* on your own).
- [ ] On your own, the pill opens *My availability* (status, hours a week,
      note) reusing My day's availability editor; saving updates the pill.
- [ ] ⋯ on someone else's: *Manage member…* (the existing panel), *Copy link
      to profile*, *See <first>'s cards in Work*.
- [ ] *Who looked N* on your own: the 30-day list with viewer, role, the tab
      each look came from and when; focus trap, Escape, focus returns; footer
      names 400 days.
- [ ] Tabs inside the head card on **both** your own and someone else's, with
      *Developer access* on your own and its "N to fix" badge on your own only.
- [ ] A plain member can open *My profile* (via LAI-1150's `/me/profile`).
- [ ] Removed: the rating card and Rate dialog, recent decisions, Current load
      and *Show current load*, the (i) definitions; their tests retired or re-aimed.
- [ ] Browser tests for each, dark + light + 390px.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).
