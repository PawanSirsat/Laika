---
id: LAI-988
title: 'Managing one person takes four screens: no admin panel on their profile'
area: web
assignee: shell
priority: p1
depends-on: [LAI-981, LAI-983, LAI-986, LAI-970]
discovered-from:
status: in-progress
started: 2026-10-22T19:15:39Z
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

## Notes

**Dependency deviation (§2 step 1).** LAI-981, LAI-983, LAI-986 and LAI-970
are in `.tasks/review/`, not `done/`, at claim time. Claimed on CHIEF's
dispatch (polly, Belka) against base `63690059` = LAI-993's server
integration + LAI-977's space settings page, which carries all four.
