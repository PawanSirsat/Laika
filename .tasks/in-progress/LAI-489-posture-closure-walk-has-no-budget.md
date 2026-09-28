---
id: LAI-489
title: "environment-posture's closure walk runs on vitest's 5s default and times out under load"
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-09-28T19:22:46Z
---

## Goal

**Make the repo-root gate independent of how busy the machine is.** This test
is the only thing that turned it red on 2026-09-28.

## What this is

CHIEF gated `master` (`b00f1ef` plus four task files and two docs edits, all
Markdown) **twice in a row**. Both runs exited `1`, **with the same single
failure**:

```
FAIL  test/tooling/environment-posture.test.ts > the list of differences stays
      honest > covers every package in the runtime closure that branches on the
      environment
Error: Test timed out in 5000ms.
 ❯ test/tooling/environment-posture.test.ts:351:3
Tests  1 failed | 2039 passed (2040)
```

**Run alone, the same file passes:** 13/13, 3.59 s of test time. The load
average was **27 on 10 cores** throughout, with other sessions' Playwright
browsers running.

**The cause is in the file, and the file's own comment names it.**

- LAI-096 moved the two child-process spawns into a `beforeAll` with
  `SPAWN_BUDGET_MS = 60_000` (`:277-286`). The comment above it (`:264-275`)
  says the earlier version *"passed alone and failed in CHIEF's full parallel
  run at 5135ms, which is the worst kind of gate: one that trains people to
  re-run rather than read."*
- **The closure walk was not moved.** `:368` calls
  `packagesBranchingOnEnvironment()` **inside the `it`**. That function
  (`server/test/helpers/runtime-closure.ts:133`) walks the runtime closure and
  `readFileSync`s every source file of 28 packages, synchronously, on vitest's
  **default 5 s**. It is the same defect, one call further down.

## Acceptance criteria

- [ ] **The closure walk runs once, in a hook with an explicit budget**, the
      same way the spawns do, and the `it` only reads the result. The comment
      at `:264-275` then describes everything slow in the file, not half of it.
- [ ] **The assertion is unchanged.** The known set, both directions
      (unreviewed and gone), and the messages stay as they are. This task moves
      the work; it does not loosen the check.
- [ ] **The check still has teeth.** Add a package name to `known` that does
      not branch, and delete a real one; show the test red for each and green
      after restoring. Confirm each edit landed before believing the red (CLAUDE.md §5).
- [ ] **No other test in `server/test/tooling/` does filesystem-wide work inside
      an `it` on the default timeout.** Sweep the directory, and say what the
      sweep found, including "nothing".
- [ ] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **Do not raise the global `testTimeout`.** That would hide the next one. The
  budget belongs on the slow work, named, as LAI-096 did.
- The same family as **LAI-456** (the events replay test with no timeout
  margin) and **LAI-452** (a flaky hook test in the gate). Both are done, and
  each fixed its own instance.
