---
id: LAI-970
title: 'Web screens still gate on org role, so an owner''s grants are ignored: admins keep controls they lost, grantees never see controls they got'
area: web
assignee: shell
priority: p1
depends-on: [LAI-958, LAI-960]
discovered-from: LAI-960
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T16:23:03Z
finished: 2026-10-22T16:48:57Z
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

- [x] One shared client source of effective permissions (extend the
      existing `useOrgActions` / `api/permissions.ts`), loaded once per
      session view, refreshed after the owner saves grants. No second copy of
      grant evaluation in the browser.
- [x] Organisation (`OrganisationScreen.tsx` ~119 and uses): Developer
      insights and Time/breaks editors follow `org.developer_insights.set` /
      `org.time.set`; Deactivate/reactivate follows `user.deactivate`; the
      invite form follows `user.invite` (roles offered as LAI-960 does); the
      role picker stays owner-only.
- [x] Organisation → Activity tab follows `audit_log.export` (tab, direct
      address, refused state).
- [x] Projects and On your plate treat a project as implicitly led when the
      server says so (`implicit_project_role` within `project_scope`), not by
      role; no Join for an implicit lead; granted member's assigned work in
      non-member projects appears; revoked admin's does not.
- [x] Board View settings → Visibility editable only when the caller holds
      `project.settings.edit` for that project per the server.
- [x] Organisation → Activity shows **every** history row the server returns
      — no `shownInFeed()` filtering (it is the full audit history); a page of
      only reorder rows is not blank. Row wording for reorders added if
      missing.
- [x] Browser tests for each surface with: admin + grant withdrawn; member +
      grant given; owner unchanged — red on today's code. Untruncated census
      of remaining `org_role`-based gates in `server/web/src`, each fixed or
      justified in the log.
- [x] Light/dark, 1440/390. Gate: `pnpm test`, `pnpm lint`, `pnpm format`
      each exit 0 on the integration branch.

## Review response — cross-vendor review, 2026-10-22 (SHELL, continuing Codex's branch)

Criteria unchanged. Each blocking item, and where it was fixed:

1. **Gates denied while unsettled/failed.** `useGates()` in
   `server/web/src/api/permissions.ts` is the one helper: `org`, `project`,
   `leads` answer `false` until `GET /permissions` has answered, and on
   failure. Every `?? <role check>` is gone. `ScreenOutlet` shows a
   *Couldn't load what you may do here* notice with **Retry** when it failed.
   `test/browser/grant-gates.test.ts` records whether a control was **ever**
   in the DOM (MutationObserver from before boot), for a held and a failing
   `/permissions`.
2. **Explicit lead keeps the context editor.** Projects asks
   `project.settings.edit` per project (`me.projects`); tested with a member
   who leads by membership and has no implicit role.
3. **Implicit viewer not offered settings.** `holdsProjectAction` answers a
   membership from `me.projects` and a non-member project from
   `implicit_project_role === 'lead'` only, mirroring `effectiveProjectRole()`
   in `server/src/policy/can.ts`. Tested on the board (Visibility, Add task).
4. **Account switch.** The store is a `useSyncExternalStore` over a module
   snapshot keyed by user; `setStoreUser` (called by the session before it
   publishes `me`) resets it. Tested: sign out and in as a second admin in the
   same tab; and a gate mounted after the first answer follows a later one.
5. **Connect asks `org.developer_insights.set`.** ShareActivity's prop is now
   `canSetInsights`; Connect and Developer access are tested to agree for an
   admin who keeps people and loses settings, and a member granted settings.
6. **Reorder wording.** `describeEvent` reads `task.updated` naming
   `position` as *reordered this task*; unit and browser tests.

Non-blocking class: every remaining role gate now reads the server's actions
and the role-copy helpers are deleted (census in `logs/shell-2026-10-22.md`).
`usePermissions().refresh` never rejects. The projects grants test waits for
its end state. The browser harness answers `/permissions` from the served
`/me` under the default grants (generated from `permissionsCatalogue()`), so
fixtures that predate LAI-970 keep their controls.

## Review response — Codex release 2 review (PR #89), 2026-10-23 (SHELL)

Criteria unchanged. Branch `release2-web-review-fixes` from `b881445f`.

- **Blocking — a failed refresh kept the last grants** (`api/permissions.ts`).
  A refresh that fails now publishes `failed` with no answer at all, so every
  gate denies and the shell's *Retry* notice shows; `refreshPermissions`
  does the same unless the caller aborted. Test: `grant-gates.test.ts` *a
  refresh that fails after a good answer withdraws everything, and offers the
  retry* — good load, then the re-read fails: Activity and Security tabs
  go, the banner comes, Retry brings them back. Red on the old code.
- **Blocking — Work's *By person* gated on `me.org_role`**
  (`work/WorkScreen.tsx`). The server serves `by_assignee` to every reader:
  `GET /tasks/summary` asks only each project's `task.read` (LAI-974,
  `summariseAllTasks` → `allTasksScope`). There is no per-person action on
  that route, so the row now asks the org grant meant for a per-person view,
  `people.analytics.read` (*See everyone's analytics*). Tests in
  `work.test.ts`: a member granted it sees the row; an admin it was withdrawn
  from never does (watched from boot). **Note for CHIEF:** the figures are
  not secret on the wire — a member can read `by_assignee` from the
  response. If they should be, the server needs a gate; that is CORE's.
- **Non-blocking — org token Revoke** (`OrganisationScreen.tsx`) now asks
  `token.revoke_any` as well as the tab's `token.list_any`. Test in
  `organisation-tokens.test.ts`.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #69, #91.
