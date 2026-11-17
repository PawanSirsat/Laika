---
id: LAI-1226
title: 'host-restart.test.ts: two restore-path tests run past vitest’s 5 s default on a laptop'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-1221
status: backlog
---

Found while running `pnpm --filter ./server exec vitest run test/tooling` as a
gate on LAI-1221 (Belka, 2026-11-16, base `b9b2e8ab`; LAI-1221 changes nothing
outside `server/web/`, so this is the base's own state).

Run alone, `test/tooling/host-restart.test.ts` fails 2 of 19, both on time
only:

```
× a restore that fails part way > says the restore failed, not that there was
  no snapshot, when the old image then refuses   5966ms
× a rolled-back image that refuses the schema > fails the step and says the
  restore is manual                               5489ms
Error: Test timed out in 5000ms.
```

The script under test is `.github/deploy/host-restart.sh` with its `sleep`
and `docker` stubbed, so the time is the script's own work on this machine,
just over the default. Either give these two cases an explicit timeout with
the reason, or find what in the restore path takes ~5 s with stubbed sleeps
(it may be a real wait the stubs do not reach). Not a product defect as far as
LAI-1221 could tell; `.github/` is not SHELL's to change.
