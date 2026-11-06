---
id: LAI-1158
title: 'SPEC §11.4.2 screen map: the Member profile row matches D-139'
area: docs
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-1152
status: done
started: 2026-11-06T11:17:29+05:30
finished: 2026-11-06T11:17:29+05:30
---

## Goal

SPEC §11.4.2's screen → endpoint table still described the old profile —
owners and admins only, `POST /users/:id/ratings`, *Current load* on
`GET /people/:id/load`. Make the *Member profile* row match D-139 and the
redesigned screen (LAI-1148), as LAI-1152's builder flagged.

## Acceptance criteria

- [x] The row says your own profile is for everyone, names every read the
      redesigned screen makes (own and someone else's, per tab), and says the
      rating and Current load are off the profile while their endpoints stay.
- [x] Every route it names exists in §6.4.

## Notes / context

Docs only (§4). LAI-1149 rewrote §11.4.2.1; this is the §11.4.2 table row it left.
