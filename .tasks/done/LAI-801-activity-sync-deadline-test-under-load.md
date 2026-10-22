---
id: LAI-801
title: 'cli activity-sync "a sync that hangs is abandoned at its deadline" counts two failures under a loaded gate — a 300 ms wall-clock deadline (cli/)'
area: cli
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-788
status: done
started: 2026-10-22T06:53:21Z
finished: 2026-10-22T06:59:00Z
accepted: 2026-10-22T09:19:01Z
---

## Goal

The root gate does not go red because the machine is busy.

## Acceptance criteria

- [x] `cli/test/activity-sync.test.ts` "a sync that hangs is abandoned at its
      deadline, and writes nothing after" asserts the deadline path without
      depending on how fast a loaded machine answers a 300 ms deadline.
- [x] Shown failing under load first (or by a slowed stub), then passing.
- [x] Gate: test, lint, format exit 0.

## Notes / context

LAI-788's root `pnpm test` (all workspaces in parallel) exited 1 on this test
alone in `cli/`: `failures` was 2 where 1 was expected and `next_sync_at` one
backoff step later; the test took 2922 ms. The same file alone: 43/43 pass.
Neither `cli/src/activity-sync.ts` nor this test file changed on LAI-788. The
same class as LAI-768 (server tests under load), which covers `server/` only.

## Renumbered

Filed as `LAI-798` on branch `LAI-788-solidtime-bridge` (commit e1035a86),
the same day the polly-time builder filed its own `LAI-798` from LAI-792's
branch. That one was filed first and keeps the id; this one became
`LAI-801` at the merge (D-089). **Commits and LAI-788's log and task file
that say `LAI-798` for this task mean this file**, and are not rewritten (§4).

## Re-diagnosed: a real bug in cli/src, not a slow test (CHIEF, 2026-10-20, before any claim)

The LAI-768 builder reproduced this **without any load**, by making the fake
board's request hang. In `cli/src/activity-sync.ts`, when the 300 ms deadline
fires while the board request is still in flight, `fail()` records a second
failure (`failures: 2`, next sync 1200 s away instead of 600 s). That happens
because, unlike `save()`, `fail()` never checks whether the sync has already
been abandoned.

**This changes the criteria**: the fix is the missing abandoned-check in
`fail()` in `cli/src/activity-sync.ts`. It is **not** a longer deadline, a
retry, or an edited test. Required:
- a test that hangs the request with no load and asserts `failures: 1` and
  the 600 s back-off;
- proof that the test fails on today's code.

The review of LAI-768 is checking the diagnosis.

## Builder notes (strelka, 2026-10-22)

- Diagnosis confirmed. The deadline aborts the in-flight sharing GET; the
  aborted request returns `{ ok: false }`, and `fail()` wrote a second backoff.
  `fail()` now throws `Abandoned` once the signal is aborted, as `save()` does
  (`cli/src/activity-sync.ts`).
- New test "a sync abandoned mid-request records one failure, not two" hangs
  the GET (no load) and waits for the real state: the abandoned fetch settles,
  then one `setImmediate`, before reading `failures` and `next_sync_at`. No
  timeouts raised, and no expected values changed.
- Red on today's code: `expected: 1, actual: 2`. With the fix the file passes
  45/45. Removing only the new guard line turns the new test red again
  (`actual: 2`); restored.
- The original deadline test is unchanged. Under load the deadline can now
  land on the GET and still record one failure.
- Built on `origin/LAI-308-activity-sync-lock-test` (PR #30), which edits the
  same test file.
