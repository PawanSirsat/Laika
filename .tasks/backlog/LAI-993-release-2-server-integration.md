---
id: LAI-993
title: 'The release-2 server branches cannot be combined: duplicate migration numbers, a grants split the reset link predates, and SPEC/test conflicts'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-976, LAI-981, LAI-982, LAI-983, LAI-984, LAI-985, LAI-986]
discovered-from:
status: backlog
---

## Goal

Integration fix-up (like LAI-969) for release 2's server work, on a branch
cut from `integration-owner-visibility-2026-10-22`. Trial merges on
2026-10-23 conflicted: LAI-983's stack × LAI-985 on `0052_*` snapshot/journal,
`server/src/policy/grants.ts`, `docs/SPEC.md`, the core log; LAI-983's stack ×
LAI-984 on `docs/SPEC.md`, the core log, `server/test/http/routes/orgs.test.ts`.

## Acceptance criteria

- [ ] Merge, in order: `origin/LAI-976-space-settings-api`,
      `origin/LAI-984-org-rename-invites-activity-export`,
      `origin/LAI-983-admin-reset-link` (carries 981, 982),
      `origin/LAI-985-more-grantable-capabilities`,
      `origin/LAI-986-offboarding-and-org-pulse` (when it exists; carries 985).
      Logs: keep every entry from both sides.
- [ ] Migrations end as one chain with no duplicate numbers, in landing
      order — expected 0051_space_settings, 0052_deactivation_ends_access,
      0053_one_owner, 0054_more_grantable_capabilities, 0055_password_resets,
      then LAI-986's if any — regenerated per
      `server/src/db/migrations/README.md` *Two migrations built in
      parallel*; SQL meaning unchanged; activity-type CHECK rebuilds compose
      (every verb added by any branch present at the end). Nothing shipped is
      renumbered.
- [ ] Grants: `user.reset_password` (LAI-983) and others sign-out (LAI-981)
      live under `deactivate_people` (LAI-985), not `manage_people`; SPEC §3
      grants table and §3.1 rows consistent; policy/matrix/drift tests green.
- [ ] SPEC and test conflicts resolved keeping both features; no behaviour
      change beyond what the merged tasks specified; each resolution listed in
      the log.
- [ ] Gate on the merged tree: `pnpm test`, `pnpm lint`, `pnpm format`.
      Allowed failures: only web halves owned by LAI-977/978/987/988/989,
      quoted exactly.
