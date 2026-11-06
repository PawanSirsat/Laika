---
id: LAI-1152
title: 'Profile shell: breadcrumb, head card with availability pill, ⋯ menu, Who looked, tabs on your own profile'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1150]
status: review
started: 2026-11-06T02:40:46+05:30
finished: 2026-11-06T11:05:57+05:30
---

## Goal

The profile's frame as the design draws it (frames A, C and the Who looked
popover), for someone else and for your own, with D-139 item 8's removals.

## Acceptance criteria

- [x] Breadcrumb *Members / <name>* or *My profile*, and the top-right notice in
      the two wordings of SPEC §11.4.2.1.
- [x] Head card: avatar ring, name, kind chip, the availability pill inline —
      including a dashed *Availability not set* — meta line, and the note /
      tags / *set by … · updated …* line (*set by you* on your own).
- [x] On your own, the pill opens *My availability* (status, hours a week,
      note) reusing My day's availability editor; saving updates the pill.
- [x] ⋯ on someone else's: *Manage member…* (the existing panel), *Copy link
      to profile*, *See <first>'s cards in Work*.
- [x] *Who looked N* on your own: the 30-day list with viewer, role, the tab
      each look came from and when; focus trap, Escape, focus returns; footer
      names 400 days.
- [ ] Tabs inside the head card on **both** your own and someone else's, with
      *Developer access* on your own and its "N to fix" badge on your own only.
- [x] A plain member can open *My profile* (via LAI-1150's `/me/profile`).
- [x] Removed: the rating card and Rate dialog, recent decisions, Current load
      and *Show current load*, the (i) definitions; their tests retired or re-aimed.
- [x] Browser tests for each, dark + light + 390px.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).

**Claimed ahead of its dependency (owner's direction, 2026-11-06).** `depends-on`
names LAI-1150, which is not in `.tasks/done/` on `master` when this is claimed.
The owner authorised the LAI-1148 programme end to end and told the team lead to
start this task before LAI-1150 merges; that is the deviation from §2 step 1,
recorded here rather than read loosely. Anything that needs LAI-1150's
`/me/profile` or `viewer.org_role` is written to switch on when it answers and to
tolerate its absence.

## Builder's notes (SHELL, at review)

- **"N to fix" on your own Developer access tab is not drawn here.** The count
  needs the own-setup reads that the Developer access screen assembles from
  several endpoints; LAI-1156 builds that tab from those reads and its own
  criterion is *"The N to fix count feeds the tab badge (LAI-1152)"*, so the
  badge lands with it. That half of the tabs criterion is left unticked; the
  tabs themselves (inside the head card, both cases, *Developer access* on
  your own) are done.
- **LAI-1150 merged while this was in flight**, so the deviation above closed
  itself: your own profile reads `GET /me/profile` and `GET /me/activity`
  (every role), and *My profile* is in every reader's menu.
- **Your own profile has no ⋯** (the design draws it on someone else's only),
  so an owner or admin no longer sets their *own* Builder/Manager kind from
  their profile; they can from anyone else's. Flagged for review.
- The design's own-profile Day, Time report and Developer access tabs reuse
  what exists until LAI-1155/1156: the embedded own day with *Edit in My
  day ›*, the Time report `scope` me titled *Time report*, and a link to the
  Developer access screen.

