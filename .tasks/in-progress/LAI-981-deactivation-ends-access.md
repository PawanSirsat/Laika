---
id: LAI-981
title: 'Deactivating someone leaves their tokens and sessions alive, and nobody can sign a person out'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T17:13:42Z
---

## Acceptance criteria (D-104 items 3, plus reads the web needs)

- [ ] Deactivation revokes every token and ends every session of the person
      (same transaction); reactivation restores neither. Tests by code.
- [ ] `POST /api/v1/users/:id/sign-out` ends all sessions (not tokens) —
      holders of *Deactivate people and reset access* (until LAI-985 lands:
      `user.deactivate`); self allowed; logged.
- [ ] `UserView` gains `last_seen_at` (latest session activity) and a
      `GET /api/v1/users/:id/memberships` read (spaces + roles), `can()`
      as profile/member reads.
- [ ] Named SPEC edits: §3.1 row for force sign-out, §6.4 lines, §4 note.
- [ ] Gate; web halves (LAI-987/988) quoted per §4.4.
