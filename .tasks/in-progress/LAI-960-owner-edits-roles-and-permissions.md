---
id: LAI-960
title: 'Roles & permissions is read-only for everyone: the owner cannot switch capabilities on or off per role'
area: web
assignee: shell
priority: p1
depends-on: [LAI-958, LAI-950]
discovered-from:
status: in-progress
started: 2026-10-22T14:08:41Z
---

## Acceptance criteria

- [ ] Organisation → Roles & permissions: the owner sees a **Who can do what**
      grid — each grantable capability × Admin / Member / Viewer as switches,
      Owner column always on and locked, owner-locked items listed as such —
      Save sends `PUT /org/permissions`; errors shown inline. Everyone else
      sees it read-only.
- [ ] Organisation → People: the role picker is shown to the owner only;
      admins see roles read-only. Invite form offers admins only the roles the
      server allows.
- [ ] The matrix tables from LAI-950 reflect grants (re-read after save).
- [ ] Every string from the server; light/dark, 1440/390; browser tests for
      owner edit round-trip, admin read-only, member read-only.
- [ ] Gate: `pnpm test` / `lint` / `format` exit 0 with LAI-958 merged.
