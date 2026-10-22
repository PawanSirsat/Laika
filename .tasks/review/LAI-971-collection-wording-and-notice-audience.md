---
id: LAI-971
title: 'The CLI still says sharing is personal, and the collection notice names "owners and admins" whatever the owner granted'
area: web
assignee: shell
priority: p1
depends-on: [LAI-963, LAI-964, LAI-958]
discovered-from: LAI-964
status: review
finished: 2026-10-22T16:28:09Z
started: 2026-10-22T16:18:11Z
---

## Goal

Codex's integration review (f66dd891) failed LAI-963/LAI-964 on wording
(D-102 amendment: never silent, no residual opt-out claims). SHELL owns
`cli/` and `server/web/`.

## Acceptance criteria

- [x] CLI: every message still implying a personal switch or "sharing is
      off" for a person — at least `cli/src/activity.ts` ~425, ~862, ~1013,
      and the backfill / token-usage / OTel paths LAI-964 left — now speaks
      of the organisation's Developer insights only. Untruncated census of
      `cli/src` listed in the log. Tests red first.
- [x] The collection notice (web + CLI) states the real audience: the owner
      and whoever the owner has granted *See everyone's analytics* — derived
      from `GET /api/v1/org/permissions` on the web (e.g. "the owner and
      admins" / "the owner, admins and members"), and stable wording in the
      CLI ("the owner and anyone they grant access"). Tests assert both the
      default and a changed-grant case.
- [x] Gate exit 0 on the integration branch.

## Builder notes (SHELL, Belka, 2026-10-22)

- Branch `LAI-971-collection-wording-and-notice-audience` on
  `integration-owner-visibility-2026-10-22` @0cf5a3a0. The gate (`pnpm test`,
  `pnpm lint`, `pnpm format`, all exit 0) ran on that branch plus these
  commits — the integration branch itself is green once this merges.
- Web audience: the owner plus every role in `roles` whose
  `grants[role].see_people_analytics` is true, from
  `GET /api/v1/org/permissions` (viewer+). Unreadable → the CLI's wording.
- Not done here (outside the files this dispatch allowed): `plugin/README.md`
  lines 125–128 and 164 still describe "Share my local activity" and
  "sharing is off". `Only an owner or admin can turn it off.` in
  `ShareActivity.tsx` is a fixed role list for `change_org_settings`, which is
  grantable too — LAI-970's gate territory, left alone.
