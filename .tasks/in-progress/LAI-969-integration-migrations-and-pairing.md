---
id: LAI-969
title: 'The owner-visibility integration cannot take LAI-958: two branches each made migration 0048, and three UNPAIRED entries go stale'
area: server
assignee: core
priority: p1
depends-on: [LAI-955, LAI-957, LAI-958, LAI-960]
discovered-from:
started: 2026-10-22T14:45:54Z
status: in-progress
---

## Goal

Integration fix-up for `integration-owner-visibility-2026-10-22`. This branch
already carries LAI-955 (`0048_org_time_breaks`) and LAI-956. Still to land:
LAI-958 (`0048_org_role_grants`), LAI-960, LAI-957 (`0049_analytics_views`,
built on 958), LAI-963, LAI-964. Merging 958 conflicts on
`meta/0048_snapshot.json` and `meta/_journal.json` (CHIEF's trial merge,
2026-10-22 20:15 IST).

## Acceptance criteria

- [ ] Merge, in order, `origin/LAI-958-owner-decides-who-sees-what`,
      `origin/LAI-960-owner-edits-roles-and-permissions`,
      `origin/LAI-957-owner-admin-read-a-persons-day`,
      `origin/LAI-963-collection-follows-the-org-switch`,
      `origin/LAI-964-tell-people-their-activity-is-collected` into this
      branch. `logs/*.md` conflicts: keep every entry from both sides.
- [ ] Migrations end as **0048_org_role_grants, 0049_analytics_views,
      0050_org_time_breaks**, regenerated per
      `server/src/db/migrations/README.md` *Two migrations built in
      parallel* (the break schedule is the one that moves; nothing has
      shipped). `migration-files.test.ts`, `db-generate.test.ts` and
      `schema-spec-drift.test.ts` green.
- [ ] `server/test/tooling/response-type-coverage.test.ts`: drop the three
      UNPAIRED entries LAI-960 paired (`OrgPermissionsView`,
      `CapabilityView`, `OwnerLockedView`) and any others the merged tree
      reports stale; nothing else in that file.
- [ ] Any other conflict or guard failure caused only by combining these
      branches is resolved without changing a feature's behaviour; each such
      resolution is listed in the log. A behaviour question goes back to
      CHIEF, not decided here.
- [ ] Gate on the merged tree: `pnpm test`, `pnpm lint`, `pnpm format`.
      Allowed failures: only endpoint-coverage entries whose web half is
      LAI-959 (`api/v1/people/*/time`, `api/v1/people/*/local-activity`,
      `api/v1/me/analytics-views`) — quoted exactly.
