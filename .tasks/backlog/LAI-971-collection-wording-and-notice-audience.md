---
id: LAI-971
title: 'The CLI still says sharing is personal, and the collection notice names "owners and admins" whatever the owner granted'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-963, LAI-964, LAI-958]
discovered-from: LAI-964
status: backlog
---

## Goal

Codex's integration review (f66dd891) failed LAI-963/LAI-964 on wording
(D-102 amendment: never silent, no residual opt-out claims). SHELL owns
`cli/` and `server/web/`.

## Acceptance criteria

- [ ] CLI: every message still implying a personal switch or "sharing is
      off" for a person — at least `cli/src/activity.ts` ~425, ~862, ~1013,
      and the backfill / token-usage / OTel paths LAI-964 left — now speaks
      of the organisation's Developer insights only. Untruncated census of
      `cli/src` listed in the log. Tests red first.
- [ ] The collection notice (web + CLI) states the real audience: the owner
      and whoever the owner has granted *See everyone's analytics* — derived
      from `GET /api/v1/org/permissions` on the web (e.g. "the owner and
      admins" / "the owner, admins and members"), and stable wording in the
      CLI ("the owner and anyone they grant access"). Tests assert both the
      default and a changed-grant case.
- [ ] Gate exit 0 on the integration branch.
