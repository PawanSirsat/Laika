---
id: LAI-1033
title: 'Refuse to boot on a schema-ahead database; the CI rollback restores the pre-migration snapshot'
area: server
assignee: polly
priority: p1
depends-on: []
discovered-from: LAI-560
status: in-progress
started: 2026-11-01T15:58:55Z
---

## Goal

CI's automatic rollback (`.github/workflows/deploy.yml`) restores only the
image. The database stays migrated, and Drizzle applies only journal entries
newer than `MAX(created_at)`, so older code on a newer schema boots silently
and ignores agent grants and claims (docs/AGENTS-ROLLOUT.md § 7, found by
LAI-560). Owner decided: fix it.

## Named files (scope)

`server/src/db/migrate.ts`, `server/test/db/schema-ahead.test.ts`,
`.github/deploy/host-restart.sh`, `.github/deploy/deploy.sh`,
`.github/workflows/deploy.yml`, `docs/AGENTS-ROLLOUT.md`,
`docs/OPERATIONS.md` (one subsection), this task file, its log.

## Acceptance criteria

- [x] Boot refuses, non-zero, naming the unknown migrations, when
      `__drizzle_migrations` holds a migration newer than every entry in the
      bundled journal; boots when every applied one is known. Tested both ways.
- [x] A mutation removing the guard turns the refusal test red.
- [x] The CI rollback restores this deploy's `pre-migration-*` snapshot when
      the rolled-back image refuses as schema-ahead; never deletes a backup;
      keeps the database it replaces beside it.
- [x] docs/AGENTS-ROLLOUT.md § 7 says what the rollback now does end to end,
      including what it does not cover.
- [ ] CI green on the PR.

## Notes

- CI green on PR #186 is the fifth criterion. The full gate was not run on
  Belka (resource rule); every changed and adjacent test file was, one at a time.
- The restore triggers on "this run's deploy wrote a pre-migration snapshot",
  not on the old image refusing. Same data loss, and it also covers rolling back
  to an image that predates the guard. Reasoning in the log and in
  docs/AGENTS-ROLLOUT.md § 7.

## Review notes (PR #186, round 1) — fixing

- B1: restore not atomic, no failure path; `docker rm` before a restore that
  can exit under `set -e` leaves no container and possibly no `laika.db`.
- Non-blocking: migrate.ts marker comment overclaims; restore should follow
  only start/health failures; a manual run needs a unique run id.
