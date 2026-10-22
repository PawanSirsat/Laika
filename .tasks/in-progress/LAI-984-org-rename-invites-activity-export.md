---
id: LAI-984
title: 'The organisation cannot be renamed, invites cannot be re-issued or given an expiry, and history cannot be exported'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T17:14:37Z
---

## Acceptance criteria (D-104 item 7; audit B7, B11)

- [ ] `PATCH /org {name}` (1–80 chars) under *Change organisation settings*.
- [ ] Invites: optional `expires_in_days` (1/7/30, default 7);
      `POST /invites/:id/reissue` (revoke + new link in one step).
- [ ] `GET /api/v1/activity/history?format=csv` streams the same filters and
      authorisation as JSON; columns documented.
- [ ] Activity rows for membership changes carry the subject user name and
      roles from/to in their payload if not already (check; no new verb).
- [ ] Named SPEC edits; gate; web half LAI-987/989.
