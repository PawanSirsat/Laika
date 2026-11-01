---
id: LAI-1037
title: 'The rollback undo never moves a pre-existing rolled-back copy over laika.db'
area: server
assignee: polly
priority: p1
depends-on: [LAI-1033]
discovered-from: LAI-1033
status: review
started: 2026-11-01T16:48:14Z
finished: 2026-11-01T16:59:51Z
---

## Goal

PR #186 review follow-ups to `.github/deploy/host-restart.sh` (LAI-1033).
`undo_restore` moves `$aside` back over `$DB` whenever `$aside` exists, so a
`laika.db.rolled-back-<ts>` already there from an earlier rollback in the same
second would replace the live database if this restore failed.

## Named files (scope)

`.github/deploy/host-restart.sh`, `server/test/tooling/host-restart.test.ts`,
`docs/AGENTS-ROLLOUT.md` (§ 7, one line), this task file, its log.

## Acceptance criteria

- [x] A restore whose `$aside` name already exists touches nothing, leaves
      `laika.db` as it was, and the undo reverses only what this run did.
      Tested, with a mutation.
- [x] The restore-FAILED path no longer prints "took no snapshot".
- [x] Tests for `ln` failing and for the `-wal` move failing: files exactly as
      before, the previous image started on the original, step red.
- [x] AGENTS-ROLLOUT § 7 says `laika.db.rolled-back-*` copies are never
      pruned and operators remove them after confirming.
- [x] CI green on the PR.

## Notes

- PR #189. CI green is the fifth criterion, checked before finish_task.
