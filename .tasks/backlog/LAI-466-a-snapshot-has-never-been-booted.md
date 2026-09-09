---
id: LAI-466
title: 'A snapshot has never been booted — the restore drill M7 exits on'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-431]
discovered-from: LAI-463
status: backlog
---

## Goal

**`backup.ts` is well tested and none of it is a restore.** Its suite opens a
snapshot and reads a row, and it specifically proves the WAL case a file copy
would tear. **What nothing does is start Laika against one.**

M7's exit is *"a stranger follows the README on a fresh VPS and is running Laika
in under ten minutes"*, and §11.6 promises fourteen nightly snapshots. **A backup
nobody has restored is a promise, not a capability** — and the failure mode is
the one that only appears on the day it matters.

## Acceptance criteria

- [ ] A test **boots the real app against a restored snapshot** and proves it is
      usable, not merely readable: `migrationsApplied` reports the same count as
      the source, `GET /api/v1/health` answers, and **a request that needs the
      actor resolves** — a token or a session from the snapshot still
      authenticates. **Reading a row proves the file; only a boot proves the
      database.**
- [ ] **The snapshot is taken while writes are in flight**, not from an idle
      database. That is the case `Database.backup()` exists for, and the case a
      drill run against a quiet instance cannot fail.
- [ ] **A snapshot restored under a different `LAIKA_SECRET` fails loudly**, and
      the test says so. `env.ts` already argues this — *"one loud failure now is
      cheaper than a silent one at restore time"* — and **nothing asserts it.**
      The encrypted columns (§12) are unreadable and the operator must find that
      out at restore, not at first use.
- [ ] **The drill is written down where an operator will look**, not only as a
      test. If that is `docs/`, **file it rather than writing it** — the sequence
      of commands is the deliverable and it is CHIEF's to place.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not add a `restore` command in this task.** Whether restoring is `cp` plus a
restart, or a CLI verb, is a decision and the CLI is SHELL's. **This task proves
the artefact is restorable; a command for doing it is a separate one** — and
proving it should come first, because a command that restores an unbootable
snapshot is worse than no command.

**The `-wal` and `-shm` files are the trap.** A restore that copies all three from
different moments is the torn read `backup.ts`'s docblock describes. **A drill
that copies only the `.sqlite` the backup job wrote is the correct one**, and the
test should make that visible rather than incidental.
