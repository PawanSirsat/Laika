---
id: LAI-1024
title: 'The zombie-harness test reads a 0.2 s child after it may have exited, and fails on a loaded runner'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-557
status: backlog
---

## What happened

CI run 41295310821 (PR #169, head `39c92568`) went red on one `cli` test:

```
cli/test/agent-session.test.ts:586  a zombie harness is dead
  › an exited, unreaped child is not alive, and its session is not renewed
error: 'the child was running'   expected: true   actual: false   (line 597)
```

The assertion that failed is the **precondition** before the zombie wait. The
test runs `sh -c 'sleep 0.2 & echo $!; exec sleep 30'`, takes the PID from
stdout, and asserts that `readProc(pid)` shows a live state. The child exits
0.2 s after it starts. If the stdout event and the `ps` reach the child later
than that, it is already a zombie (`Z`), and `isDeadState` is right to call it
dead. On CI, `cli` runs alongside `server` and `server/web` in one job, so a
200 ms gap is easy to exceed.

## Measured (Belka, 2026-11-01, outside the suite)

The test's own setup and functions, with only the gap before the first `ps`
changed:

```
gap 0 ms:   state=S → "the child was running" holds
gap 250 ms: state=Z → "the child was running" FAILS
```

It is not new code: LAI-557's branch does not touch this test, `readProc`,
`procReader` or `isDeadState`, and the same test passed on that branch's three
earlier green heads. It appears in none of the 13 other failed CI runs since
2026-10-31 (each `--log-failed` grepped for its two messages), so it is rare,
not constant.

## Goal

The test still proves that a real, unreaped zombie is dead and renews nothing,
without a precondition that depends on scheduling.

## Scope

- `cli/test/agent-session.test.ts` only. Make the child outlive the first read
  under any load. For example, the child waits on something the test controls
  (a FIFO it reads, or a signal) and exits only when the test says so, after
  `before` is taken. A longer `sleep` only moves the window.
- No change to `cli/src/agent-session.ts`: the code under test is correct.

## Acceptance criteria

- [ ] The precondition no longer depends on how long the runner takes to
      reach `ps`. A delay of seconds inserted before the first `readProc`
      (by hand, then removed) does not fail it.
- [ ] Deliberate break: `isDeadState` returning false for `Z` still turns
      this test red.
- [ ] Repo-root gate exits 0 (CI).

## Role / machine

SHELL. One test file, single worker; no full suite on Belka.
