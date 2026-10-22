---
id: LAI-970
title: 'Web screens still gate on org role, so an owner''s grants are ignored: admins keep controls they lost, grantees never see controls they got'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-958, LAI-960]
discovered-from: LAI-960
status: backlog
---

## Goal

Codex's integration review of `integration-owner-visibility-2026-10-22`
(f66dd891, 2026-10-22) failed LAI-883, LAI-951, LAI-956, LAI-960 and LAI-961
on one shared defect: the web decides who sees a control from `me.org_role`
(`canManageOrg`, `canConfigureProject`, `permissionHolder`) while the server,
since LAI-958, decides from the owner's grants. Make every gate read the
server's effective permissions (`GET /api/v1/permissions` → `me.actions`,
`me.implicit_project_role`, `me.project_scope`, per-project `me.projects`),
never a role list.

## Acceptance criteria

- [ ] One shared client source of effective permissions (extend the
      existing `useOrgActions` / `api/permissions.ts`), loaded once per
      session view, refreshed after the owner saves grants. No second copy of
      grant evaluation in the browser.
- [ ] Organisation (`OrganisationScreen.tsx` ~119 and uses): Developer
      insights and Time/breaks editors follow `org.developer_insights.set` /
      `org.time.set`; Deactivate/reactivate follows `user.deactivate`; the
      invite form follows `user.invite` (roles offered as LAI-960 does); the
      role picker stays owner-only.
- [ ] Organisation → Activity tab follows `audit_log.export` (tab, direct
      address, refused state).
- [ ] Projects and On your plate treat a project as implicitly led when the
      server says so (`implicit_project_role` within `project_scope`), not by
      role; no Join for an implicit lead; granted member's assigned work in
      non-member projects appears; revoked admin's does not.
- [ ] Board View settings → Visibility editable only when the caller holds
      `project.settings.edit` for that project per the server.
- [ ] Organisation → Activity shows **every** history row the server returns
      — no `shownInFeed()` filtering (it is the full audit history); a page of
      only reorder rows is not blank. Row wording for reorders added if
      missing.
- [ ] Browser tests for each surface with: admin + grant withdrawn; member +
      grant given; owner unchanged — red on today's code. Untruncated census
      of remaining `org_role`-based gates in `server/web/src`, each fixed or
      justified in the log.
- [ ] Light/dark, 1440/390. Gate: `pnpm test`, `pnpm lint`, `pnpm format`
      each exit 0 on the integration branch.
