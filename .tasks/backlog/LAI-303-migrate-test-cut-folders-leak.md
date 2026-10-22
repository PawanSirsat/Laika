---
id: LAI-303
title: 'migrate.test leaves two cut migration folders in the temp dir on every run'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-848
status: backlog
---

## Goal

Every server test run leaves no `laika-mig-*` folder behind in the temp
directory. A shared, contended machine accumulates them gate after gate, and
the disk they take is paid by every later run.

## Acceptance criteria

- [ ] `folderWithoutTheLast()` (`server/test/db/migrate.test.ts:333`) and
      `folderAt0028()` (`:445`) no longer leave their cut folder behind: run
      the file with `TMPDIR` pointed at an empty directory and that directory
      is empty afterwards.
- [ ] A census of every `mkdtempSync` under `server/test/` (no `head`) is
      recorded in the task, each site marked removed or already removed.
- [ ] The migration checks are unchanged, and the root test/lint/format
      commands each exit 0.

## Notes / context

Found on LAI-848 (Strelka, 2026-10-21). LAI-848 fixed the same leak in
`server/test/db/project-statuses.test.ts`, which left 14 `laika-mig-*`
folders (58 MB) per run before; with a private `TMPDIR` it now leaves none.
Strelka's `$TMPDIR` held 534 `laika-mig-*` folders at the time. In
migrate.test the cases remove their database directory in `finally`, not the
cut migrations folder the helpers return. LAI-768 already dropped the 3.3 MB
of snapshots from each copy, so each leak is now about 0.6 MB.
