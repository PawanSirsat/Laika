---
id: LAI-489
title: "environment-posture's closure walk runs on vitest's 5s default and times out under load"
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: done
finished: 2026-09-28T19:31:08Z
started: 2026-09-28T19:22:46Z
reviewed: 2026-09-28T19:31:08Z
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

- [x] **The closure walk runs once, in a hook with an explicit budget**, the
      same way the spawns do, and the `it` only reads the result. The comment
      at `:264-275` then describes everything slow in the file, not half of it.
- [x] **The assertion is unchanged.** The known set, both directions
      (unreviewed and gone), and the messages stay as they are. This task moves
      the work; it does not loosen the check.
- [x] **The check still has teeth.** Add a package name to `known` that does
      not branch, and delete a real one; show the test red for each and green
      after restoring. Confirm each edit landed before believing the red (CLAUDE.md §5).
- [x] **No other test in `server/test/tooling/` does filesystem-wide work inside
      an `it` on the default timeout.** Sweep the directory, and say what the
      sweep found, including "nothing".
- [x] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- **Do not raise the global `testTimeout`.** That would hide the next one. The
  budget belongs on the slow work, named, as LAI-096 did.
- The same family as **LAI-456** (the events replay test with no timeout
  margin) and **LAI-452** (a flaky hook test in the gate). Both are done, and
  each fixed its own instance.

## Built — 2026-09-28T19:31:08Z

Built by the CHIEF session **on the owner's direct instruction**
(*"complete all"*), on branch `build`. The file is CORE's; the assignee says
`core` because this is CORE's task, done for them.

**`environment-posture`:** the closure walk runs once, in the describe's
`beforeAll`, on `CLOSURE_BUDGET_MS`, and the `it` reads the result. The
assertion is unchanged, and it still has teeth:

- a non-branching package added to `known`: **red**, *"no longer branch"*;
- `nanostores` deleted: **red**, *"started branching"*.

**The sweep of `server/test/tooling/`**, all 13 files, not sampled:

| file | IO in an `it` on the default budget | done |
| --- | --- | --- |
| `task-file-state` | ~500 task files re-read about 8 times | read once, `beforeAll` on `SCAN_BUDGET_MS` |
| `response-type-coverage` | three `src/` walks, many times | memoised, warmed on `CENSUS_BUDGET_MS` |
| `format-fix` | 5 `git` spawns per hook, Prettier per test | `SPAWN_BUDGET_MS` on the hooks and each `describe` |
| `activity-payload-names` | `src/` walk plus reading every file | memoised, warmed on `SCAN_BUDGET_MS` |
| `shadowed-bounds` | `routes/` and `services/` walks plus reads | memoised, warmed on `SCAN_BUDGET_MS` |
| `structure` | `test/` and `web/test/` walks, whole-tree reads | cache warmed on `READ_BUDGET_MS` |
| `build` | see below | a free port, and the health check proves identity |
| `schema-spec-drift` | one `readdir` of `.tasks/done`, names only | none needed |
| `env-contract`, `policy-spec-drift` | one or two known files | none needed |
| `schema-migration-drift`, `toolchain` | no IO | none needed |

**`build.test.ts` was not load. It was a real bug.**

- The file bound a **fixed port, 3187**, and every worktree runs it. Two
  sessions gating at once collided: the second child failed to bind,
  `waitForHealth` got a `200` from **the other session's** server, and the
  test SIGTERMed its own child mid-boot, so the exit code was `null`.
- Reproduced deterministically: a fake server answering health on the port,
  run against the old wait, gives **`expected null to be +0`**, tonight's
  exact line.
- Now: `freePort()` from the OS, and `waitForHealth` refuses a server whose
  `uptime_ms` is older than our child (the §4.3 rule). The same fake server
  now gives *"answered by another server"*, loudly.

**The structure cache was proven, not assumed.** A temporary non-component
`.tsx` probe turned the check red through the cache and was removed. I also
caught and fixed a shadowed-name bug of my own in that edit before running
it: `.test(source)` would have read the function, not the text.

**Measured under load:** the full server suite is **2040/2040**, with the
load average at **30.6** when it finished.

**Duplicate:** SHELL's **LAI-625** (on `shell`, backlog) files the same
defect from LAI-623 with the five-file evidence. **This task was filed first**,
and its sweep covers all five, so LAI-625 closes as a duplicate when `shell`
next reaches `master`.

## Review — 2026-09-28T19:31:08Z (CHIEF)

**Accepted.** The same session built and reviewed this, on the owner's
instruction, in CORE's area. It is recorded as a crossing made on that
instruction, not as a precedent.

- Every criterion is met.
- The sweep is a census of all 13 files.
- The posture check's teeth are shown in both directions.
- The one "flake" that was a real port collision is reproduced and fixed.
- The server suite passes at load 30.
