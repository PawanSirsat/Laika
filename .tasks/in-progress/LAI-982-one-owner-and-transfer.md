---
id: LAI-982
title: 'The role picker can make a second owner and there is no way to transfer ownership'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-22T18:10:05Z
---

## Acceptance criteria (D-104 item 2)

- [ ] `PATCH /users/:id {org_role: 'owner'}` refused `422` (`use_transfer`).
- [ ] `POST /api/v1/org/transfer-ownership {user_id, confirm}` — owner only,
      session only, active admin/member target; target becomes owner, caller
      admin, `orgs.owner_user_id` updated, one transaction, logged.
- [ ] Startup/health or a read reports when more than one owner exists
      today (no silent demotion); test.
- [ ] Named SPEC edits: §3.1 transfer row, §6.4 lines. Gate; web half LAI-987.
