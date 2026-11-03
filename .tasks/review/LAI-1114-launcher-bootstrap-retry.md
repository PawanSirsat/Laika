---
id: LAI-1114
title: 'Launcher enable survives a re-run (bootout settles before bootstrap), and an unreachable board is a skipped check, not a refusal'
area: cli
assignee: shell/belka
priority: p2
depends-on: []
started: 2026-11-04T00:40:00+05:30
finished: 2026-11-04T00:45:00+05:30
status: review
discovered-from: LAI-1113
---

## Why

Seen on Belka 2026-11-03 after #260 (LAI-1113). Two things.

1. Re-running `laika agent launcher enable` while the launcher is already on
   exits 1 with `launchctl bootstrap failed: Bootstrap failed: 5:
   Input/output error`. `installService` in
   `cli/src/agent-launcher-service.ts` runs `launchctl bootout` and then
   `launchctl bootstrap` at once, before launchd has finished removing the
   old job.
2. The audit and `watch` line `refused a task: owner_unknown` appears when the
   launcher could not reach the board to look up the credential's owner (a
   network drop). Nothing was refused.

## Acceptance criteria

- [x] After `bootout`, `installService` waits, bounded (about 10 s), until
      `launchctl print gui/<uid>/ai.laika.launcher` reports the job gone, then
      bootstraps.
- [x] A `bootstrap` failing with error 5 or 37 is retried a few times with a
      short backoff.
- [x] If it still fails, the exact manual command
      (`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.laika.launcher.plist`)
      is printed and `enable` exits non-zero.
- [x] Tests with a fake runner: the job lingers then disappears; bootstrap
      fails once with 5 then succeeds; a persistent failure prints the command.
- [x] An owner lookup that cannot be answered is audited as its own event kind,
      `skipped` with `reason: owner_unknown`, not `refused`; `owner_mismatch`
      stays `refused`.
- [x] `watch` renders it as `skipped a check: could not reach the board to
      confirm the owner (will retry)`. Tested.
- [x] `cli/README.md` says both.

## Notes

Files: `cli/src/agent-launcher-service.ts`, `cli/src/agent-launcher.ts`,
`cli/src/agent-launcher-watch.ts`, `cli/test/agent-launcher-service.test.ts`,
`cli/test/agent-launcher.test.ts`, `cli/test/agent-launcher-watch.test.ts`,
`cli/README.md`. No new dependency.
