---
id: LAI-994
title: 'SPEC §4.58 still lists manage_people as a capability; LAI-985 replaced it'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-985]
discovered-from: LAI-993
status: backlog
---

## What is wrong

`docs/SPEC.md` §4.58 `org_role_grants`, the `capability` row, reads:

> `see_people_analytics` \| `see_org_activity` \| `open_all_projects` \|
> `manage_people` \| `change_org_settings` (CHECK)

Since LAI-985 (migration `0054_more_grantable_capabilities` in the release-2
chain) the CHECK is `see_people_analytics`, `see_org_activity`,
`open_all_projects`, `invite_people`, `deactivate_people`,
`create_archive_projects`, `manage_any_tokens`, `change_org_settings`
(`server/src/db/enums.ts` `CAPABILITIES`). §3's grants table is already right.

No guard caught it: `schema-spec-drift.test.ts` does not compare this row's
values with the CHECK. Found while integrating release 2 (LAI-993); not
edited there, because §4.58 was not a named edit of any merged task.

## Acceptance criteria

- [ ] §4.58's `capability` row lists the eight values `CAPABILITIES` holds, in
      its order.
