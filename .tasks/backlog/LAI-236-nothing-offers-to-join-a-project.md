---
id: LAI-236
title: Nothing offers to join a project
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-460
status: backlog
---

## Goal

`POST /api/v1/projects/:slug/join` is served and **called by nothing**
(LAI-460). §11.4.2's Projects screen lists projects; a member with no membership
has no way to take one on except by being added by a lead.

## Acceptance criteria

- [ ] The Projects screen offers to join where the API allows it, and does not
      offer where it does not — the affordance follows the permission, not the
      other way round.
- [ ] After joining, the screen reflects the membership the **response**
      reports, not the one that was requested.
- [ ] LAI-460's exemption for `api/v1/projects/*/join` is removed.
- [ ] Full gate `EXIT 0`.
