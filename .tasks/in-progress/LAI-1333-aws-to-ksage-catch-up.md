---
id: LAI-1333
title: 'Final catch-up: old Laika (AWS) into Ksage, then switch everyone over'
area: ops
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-18T11:54:31Z
---

## Goal

Owner, 2026-11-18 (board LAIKA-1139). Ksage was seeded from an AWS production copy on
2026-11-17 (taken about 2026-11-16T20:48Z). Work kept landing on the old Laika
(http://52.72.203.206) because everyone's tools still point there. This brings that work
across into Ksage (https://ksage.kvelld.com), then switches everyone over.

Nothing is written to either production database until the owner has approved the
dry-run report through CHIEF.

## Owner's decisions (2026-11-18)

- **Conflicts:** when a task changed on both boards since the copy, the newest change wins
  (`updated_at` per task).
- **Bring over:** tasks (new and changed: status, assignee, title, description, dates,
  labels, dependencies), comments, time logs (entries, drafts and their revisions) and
  activity history.
- **Time logs:** mirror edits and deletes made on the old Laika after the copy.
- **Task keys:** the old Laika keeps its numbers. A Ksage-only task whose key clashes is
  renumbered, and its old key keeps working as an alias.
- **Structure:** spaces, people, sprints, labels and statuses created on the old Laika since
  the copy are created on Ksage, reusing existing ones by space name or person email.
- **Run:** a dry run first, with a report per space; the owner approves; then the real run,
  with a full backup taken first.
- **Cutover:** afterwards, repoint laptops, agents and Claude Code to Ksage. The old Laika
  stays up; no read-only switch is built.
- **Keep Ksage-only data:** SSO accounts, Outlook calendar entries (`source='calendar'`),
  space icons, and Ksage's own settings (Teams, email, calendar, SSO, store).

## Acceptance criteria

- [x] Fresh read-only copies of both production DBs are on Belka, taken without disturbing
      either live board.
- [x] A merge script runs against the copies only and writes (a) a dry-run report per space:
      added, changed, renumbered, conflicts, mirrored time-log edits and deletes, created
      spaces/people/sprints; (b) a merged DB to a scratch file; (c) proof checks: nothing on
      Ksage lost apart from the planned changes, every AWS row since the copy present,
      `foreign_key_check` and `integrity_check` clean.
- [x] The report, a proposed apply method with its trade-offs, and a cutover checklist go to
      CHIEF for the owner. The owner approves the report.
- [x] The real run happens with a full backup taken first.
- [x] The proof shows nothing missing and nothing unexpected changed.
- [x] Spot checks: 3 tasks, 3 time logs and 1 renumbered task. (No task needed renumbering:
      Ksage created none before the run. The renumber path was tested on a fixture instead.)
- [ ] Cutover checklist done.

## Notes / context

- Rows that existed at the copy carry the same ids on both boards; new rows have their own
  ULIDs, so only per-space task numbers can clash.
- `activity`, `time_entry_revisions` and others are append-only (triggers in
  `server/src/db/migrate.ts`): insert, never update.
- Old Laika: EC2 over SSM (profile `laika`), DB `/data/laika.db` in container `laika`.
- Ksage: Coolify app "Ksage Backend" (dwhzvmuooi3hgycgbwqbwygc), DB `LAIKA_DB_PATH` =
  `/data/ksage-seed.db`, reached by a Coolify scheduled task (255-char commands). Auto
  deploy is on for the `laika` branch of KvellDynamics/ksage-2.0.
- Database copies and the merged DB live in the session scratchpad, never in the repo.

## Progress (2026-11-18)

- Dry run reported to CHIEF; the owner approved: apply method A (swap), extras proof + unlisted
  + new-agent, no space settings, cursors moved, Pawan's overlap brought as is.
- Swap done 12:56–13:09Z. The pre-swap backup is `/data/backups/pre-lai1333-20261118T125629Z.db`
  on Ksage, kept until the owner says.
  - Calendar sync was paused 12:56:20Z and is back on through the restore.
  - Post-swap verify is in `logs/chief-2026-11-18-LAI-1333.md`.
- Left: the cutover checklist (`tools/lai-1333-aws-to-ksage/dry-run-report.md`) and a delta run
  for AWS writes after 2026-11-18T12:59:59Z. The delta run needs its own go.
