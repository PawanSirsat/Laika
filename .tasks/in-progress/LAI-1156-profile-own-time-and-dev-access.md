---
id: LAI-1156
title: 'Profile Time report and Developer access on your own profile'
area: web
assignee: shell
priority: p2
depends-on: [LAI-1151, LAI-1152]
status: in-progress
started: 2026-11-06T11:56:00+05:30
---

## Goal

Your own profile's Time report and Developer access tabs (frames E and F).

## Acceptance criteria

- [ ] Time report tab on your own profile is the shared Time report, `scope`
      me, titled *Time report*.
- [ ] Developer access on your own: the Developer setup layout from your own
      reads (`/devices`, `/agents`, `/project-setups`, `/tokens` and LAI-1151's
      pending requests and activity), the own-setup notice, pending pairing
      requests with **Approve / Decline**, unpair and revoke without the
      owner-decision label, and the own empty states.
- [ ] The "N to fix" count feeds the tab badge (LAI-1152).
- [ ] Browser tests: own setup renders, approve and decline call the existing
      endpoints, attention links focus their item.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. SHELL's area (`server/web/`).
