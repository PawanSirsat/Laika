---
id: LAI-988
title: 'Managing one person takes four screens: no admin panel on their profile'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-981, LAI-983, LAI-986, LAI-970]
discovered-from:
status: backlog
---

## Acceptance criteria (audit C2, C3, C4, B13)

- [ ] Member profile gains an **Admin** panel for holders: role (owner-only
      picker), deactivate/reactivate with the **offboarding dialog** (open
      tasks: unassign / reassign), **Sign out everywhere**, **Reset link**
      (shown once, copy), tokens (list + revoke), and **Spaces** (list with
      roles, add to spaces with role, remove) via the new memberships read.
- [ ] Space Members removal (LAI-977) uses the same offboarding dialog.
- [ ] Permissions from the server only; confirmations; light/dark, 1440/390;
      browser tests. Gate exit 0 with servers merged.
