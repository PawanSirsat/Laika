---
id: LAI-986
title: 'Removing or deactivating someone leaves their open tasks assigned; the organisation overview has no pulse'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-981]
discovered-from:
status: backlog
---

## Acceptance criteria (D-104 item 5; audit C5)

- [ ] Member removal and deactivation accept `open_tasks: 'unassign' |
      { reassign_to: user_id }`; without it, `409` with the count and keys of
      open tasks (so the UI can ask). Reassign target must be able to hold the
      tasks (LAI-962 rule). Deactivation also removes space memberships.
- [ ] `GET /api/v1/org/overview` (org.read): people active this week, open /
      in review / blocked / overdue counts (reuse LAI-974's definitions).
- [ ] Named SPEC edits; gate; web halves LAI-988/989.
