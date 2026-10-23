---
id: LAI-993
title: 'The release-2 server branches cannot be combined: duplicate migration numbers, a grants split the reset link predates, and SPEC/test conflicts'
area: server
assignee: core
priority: p1
depends-on: [LAI-976, LAI-981, LAI-982, LAI-983, LAI-984, LAI-985, LAI-986]
discovered-from:
status: review
started: 2026-10-22T18:56:17Z
finished: 2026-10-22T19:11:05Z
---

## Goal

Integration fix-up (like LAI-969) for release 2's server work, on a branch
cut from `integration-owner-visibility-2026-10-22`. Trial merges on
2026-10-23 conflicted: LAI-983's stack × LAI-985 on `0052_*` snapshot/journal,
`server/src/policy/grants.ts`, `docs/SPEC.md`, the core log; LAI-983's stack ×
LAI-984 on `docs/SPEC.md`, the core log, `server/test/http/routes/orgs.test.ts`.

## Acceptance criteria

- [x] Merge, in order: `origin/LAI-976-space-settings-api`,
      `origin/LAI-984-org-rename-invites-activity-export`,
      `origin/LAI-983-admin-reset-link` (carries 981, 982),
      `origin/LAI-985-more-grantable-capabilities`,
      `origin/LAI-986-offboarding-and-org-pulse` (when it exists; carries 985).
      Logs: keep every entry from both sides.
- [x] Migrations end as one chain with no duplicate numbers, in landing
      order — expected 0051_space_settings, 0052_deactivation_ends_access,
      0053_one_owner, 0054_more_grantable_capabilities, 0055_password_resets,
      then LAI-986's if any — regenerated per
      `server/src/db/migrations/README.md` *Two migrations built in
      parallel*; SQL meaning unchanged; activity-type CHECK rebuilds compose
      (every verb added by any branch present at the end). Nothing shipped is
      renumbered.
- [x] Grants: `user.reset_password` (LAI-983) and others sign-out (LAI-981)
      live under `deactivate_people` (LAI-985), not `manage_people`; SPEC §3
      grants table and §3.1 rows consistent; policy/matrix/drift tests green.
- [x] SPEC and test conflicts resolved keeping both features; no behaviour
      change beyond what the merged tasks specified; each resolution listed in
      the log.
- [x] Gate on the merged tree: `pnpm test`, `pnpm lint`, `pnpm format`.
      Allowed failures: only web halves owned by LAI-977/978/987/988/989,
      quoted exactly.

## Submitted (CORE, 2026-10-22)

**Merged, in order:** `origin/LAI-976-space-settings-api` (f6c31e43),
`origin/LAI-984-org-rename-invites-activity-export` (99a4fedf),
`origin/LAI-983-admin-reset-link` (c4e1c280; carries 981, 982),
`origin/LAI-985-more-grantable-capabilities` (1e6039cf),
`origin/LAI-986-offboarding-and-org-pulse` (184e5275; carries 985 and
LAI-974's `/tasks/summary`).

**Migration chain** (journal `when` strictly increasing; `prevId` links each to
the one before):

| idx | tag | when | from |
| --- | --- | --- | --- |
| 50 | `0051_space_settings` | 1792690867107 | LAI-976, unchanged |
| 51 | `0052_deactivation_ends_access` | 1792695705934 | LAI-981, regenerated, SQL byte-identical |
| 52 | `0053_one_owner` | 1792695711370 | LAI-982, regenerated, SQL byte-identical |
| 53 | `0054_more_grantable_capabilities` | 1792695718188 | LAI-985, regenerated; its hand-edited SQL put back verbatim |
| 54 | `0055_password_resets` | 1792695724558 | LAI-983, regenerated, SQL byte-identical |

Each was generated against the schema as of its step (later branches' changes
taken out temporarily, then restored and compared byte-for-byte with the
merged files). A further `db:generate` writes nothing. Activity CHECKs
compose: 0052 adds `user.signed_out`, 0053 adds `org.ownership_transferred`;
no other branch adds a verb. LAI-986 adds no migration.

**Conflicts and resolutions:** see the log entry (every one listed).

**Grants:** `user.sign_out` and `user.reset_password` are under
`deactivate_people` beside `user.deactivate` (`policy/grants.ts`, SPEC §3
table); LAI-985's two tests pinning that capability updated.

**Discovered:** LAI-994 — SPEC §4.58's capability column still names
`manage_people` (LAI-985's), unguarded.

### Red by design (§4.4) — web halves only

`pnpm test` exits 1; server 3848 passed / 10 skipped, cli 604 / 0; web 2988
pass / 5 fail, all in `server/web/` lists:

1. `server/web/test/api/activity-labels.test.ts:40` *activity wording covers
   the server’s vocabulary* — `+ 'user.signed_out'`, `+ 'org.ownership_transferred'` (LAI-987/988)
2. `server/web/test/api/endpoint-coverage.test.ts:255` *every served endpoint
   has a caller, or a named reason* — `+ 'api/v1/invites/*/reissue'` (989),
   `'api/v1/org/overview'` (988/989), `'api/v1/org/transfer-ownership'` (987),
   `'api/v1/password-resets/consume'` (988), `'api/v1/projects/*/leave'`
   (977), `'api/v1/tasks/summary'` (975), `'api/v1/users/*/memberships'`,
   `'api/v1/users/*/reset-link'`, `'api/v1/users/*/sign-out'` (988)
3. `server/web/test/api/use-events.test.ts:31` *the stream subscribes to
   exactly what the server emits* — server list adds `user.signed_out`,
   `org.ownership_transferred` (987/988)
4. `server/web/test/api/view-type-drift.test.ts:689` *every server field is
   visible to the client* — `OrgView.extra_owners` (987), `ProjectSummary.agents_allowed`,
   `.color`, `.former_prefixes`, `.task_create_min_role` (977/978),
   `UserView.last_seen_at` (987), `CapabilityView.description` (989)
5. `server/web/test/routes/screens/dashboard/dashboard-derive.test.ts:237`
   *describeProjectEvent* — `+ 'user.signed_out'`, `+ 'org.ownership_transferred'` (987/988)
