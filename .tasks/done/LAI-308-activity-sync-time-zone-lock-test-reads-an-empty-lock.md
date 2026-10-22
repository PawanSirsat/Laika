---
id: LAI-308
title: 'activity-sync "a holder that started under another time zone keeps the lock" reads the lock before the holder has written it'
area: cli
assignee: strelka
priority: p3
depends-on: []
discovered-from: LAI-854
status: done
started: 2026-10-22T06:24:16Z
finished: 2026-10-22T06:34:18Z
accepted: 2026-10-22T09:19:01Z
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

- [x] The test waits for what it then asserts (the lock's content holding a
      pid), not for the file existing — or `acquireLock` writes the lock so
      that it is never seen empty, if that is the real defect. Find out which,
      with evidence.
- [x] Break the fix once and watch this assertion go red; restore.
- [x] The file passes alone and in a root gate. `pnpm test`, `pnpm lint` and
      `pnpm format` each exit 0.

## Notes

- `cli/` only. No new dependency. No retry, no sleep.

## Builder notes (strelka)

- **The defect was in `acquireLock`, not only the test.** It created the lock
  with `openSync('wx')` and wrote the holder afterwards. An empty lock reads as
  no holder (`readHolder('')` → `undefined`), so a sync arriving in that window
  broke and took a live sync's lock. Shown directly: an empty `sync.lock`
  handed to `acquireLock` is taken (`second acquirer got the lock: true`).
- `cli/src/activity-store.ts` — the holder is written to
  `sync.lock.<pid>.tmp` and `linkSync`ed into place: atomic like `wx`, fails
  `EEXIST` the same way, and the lock appears with its holder in it. The temp
  file is removed in `finally`.
- `cli/test/activity-sync.test.ts` — new test *"the lock is never seen before
  its holder is written in it"*: the holder process is stopped at its write
  (patched `fs.writeSync`/`writeFileSync`, released by a line on stdin) and the
  lock is read at that moment. No sleep, no retry, no load. The time-zone test
  is unchanged; its wait on existence is now a wait on content.
- Fail-first: red on the old code, `the lock was there before its holder: ""`.
  Mutation (old open-then-write restored, anchor checked): red, same message;
  restored: green.
