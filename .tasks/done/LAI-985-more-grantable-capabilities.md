---
id: LAI-985
title: 'The owner cannot grant space creation, token management, or invite without deactivate; capabilities have no descriptions'
area: server
assignee: core
priority: p2
depends-on: [LAI-981]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T18:10:23Z
finished: 2026-10-22T18:19:29Z
---

## Acceptance criteria (D-104 item 6)

- [x] New capabilities *Create and archive spaces*, *Manage anyone's tokens*;
      *Manage people* splits into *Invite people* and *Deactivate people and
      reset access* (covering LAI-981's sign-out and LAI-983's reset link).
      Defaults = today; migration maps existing stored grants (the old
      manage_people value → both halves).
- [x] Each capability has a server-provided one-line `description`.
- [x] Policy/matrix/drift tests updated cell by cell; owner-locked unchanged.
- [x] Named SPEC edits (§3 grants table). Gate; web half LAI-989.

## Notes (CORE, on submission)

- **Deviation, §2 step 1:** `depends-on: [LAI-981]`, and LAI-981 is not in
  `.tasks/done/`. Claimed on CHIEF's direction, built on
  `LAI-981-deactivation-ends-access` @50d8367b.
- Ids: `invite_people` (*Invite people*: `user.invite`), `deactivate_people`
  (*Deactivate people and reset access*: `user.deactivate`, `user.sign_out`;
  LAI-983 adds `user.reset_password` to `CAPABILITY_ACTIONS.deactivate_people`),
  `create_archive_projects` (*Create and archive spaces*: `project.create`,
  `project.archive`), `manage_any_tokens` (*Manage anyone's tokens*:
  `token.list_any`, `token.revoke_any`). `manage_people` is gone.
- `description` is on each entry of `capabilities` in `GET`/`PUT
  /org/permissions` (`CAPABILITY_DESCRIPTIONS`).
- Migration **0052_more_grantable_capabilities**: hand-edited after
  `db:generate`. It rebuilds `org_role_grants` for the new CHECK, copies
  every non-`manage_people` row, and writes each `manage_people` row as
  `invite_people` and `deactivate_people` (same `granted`, `set_by`,
  `updated_at`). The new capabilities get no row and read as their defaults.
  CHIEF renumbers if LAI-982 also takes 0052.
- Owner-locked list unchanged; defaults unchanged (admin holds all).
- **Web half, §4.4 (LAI-989/LAI-960):** any failure in the gate is quoted in
  the log entry for this task.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #78.
