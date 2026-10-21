---
id: LAI-308
title: 'activity-sync "a holder that started under another time zone keeps the lock" reads the lock before the holder has written it'
area: cli
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-854
status: backlog
---

## Goal

`cli/test/activity-sync.test.ts:717` does not fail a root gate under load,
and still proves that a lock taken under another `TZ` is not stolen.

## What was measured (LAI-854's root gate on Strelka, 2026-10-21)

- Failed once in five root gates, at 1-minute load ≈ 17–23:
  `The input did not match the regular expression /"pid":359[,}]/. Input: ''`
  (`activity-sync.test.ts:737`).
- The test waits for `existsSync(w.paths.lock)` and then reads the file. The
  read returned the **empty string**: the holder had created the lock and not
  yet written its JSON. A wait on existence, followed by a read of content.
- `node --test test/activity-sync.test.ts` alone, same tree, straight after:
  exit 0, 43/43.
- LAI-801 covers a different test in the same file (the deadline one), not
  this one.

## Acceptance criteria

- [ ] The test waits for what it then asserts (the lock's content holding a
      pid), not for the file existing — or `acquireLock` writes the lock so
      that it is never seen empty, if that is the real defect. Find out which,
      with evidence.
- [ ] Break the fix once and watch this assertion go red; restore.
- [ ] The file passes alone and in a root gate. `pnpm test`, `pnpm lint` and
      `pnpm format` each exit 0.

## Notes

- `cli/` only. No new dependency. No retry, no sleep.
