---
id: LAI-625
title: The tooling tests fail on a 5000ms budget under parallel load
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-623
status: backlog
---

## What is wrong

Five files under `server/test/tooling/` fail the repo-root gate with
`Error: Test timed out in 5000ms` when the machine is busy, and pass when run
alone. They walk the filesystem and spawn `git`, on vitest's default 5s budget.

**The count moves without the code moving**, which is the measurement that
makes this a flake rather than a regression. Three consecutive `pnpm test` runs
on one unchanged tree:

| run | failures | conditions |
| --- | --- | --- |
| 1 | **10** | a mutation harness running alongside |
| 2 | **5** | — |
| 3 | **1** | quiet machine |

Run alone, every one of them is green: `task-file-state` 11/11,
`response-type-coverage` 10/10, `environment-posture` 13/13,
`structure` 20/20, `format-fix` green.

Files seen failing across those runs:

- `test/tooling/environment-posture.test.ts`
- `test/tooling/response-type-coverage.test.ts`
- `test/tooling/task-file-state.test.ts`
- `test/tooling/format-fix.test.ts`
- `test/tooling/build.test.ts` (`shuts down promptly with an SSE stream open`)

## Why it matters more than an ordinary flake

**These are the repo's own guards**, and they are the ones a builder is told to
trust when deciding whether their work is green. A guard that fails for reasons
unrelated to the code teaches everyone to read `EXIT 1` and shrug — which is
the exact habit CLAUDE.md §5 spends a page trying to prevent. The cost is
already visible: LAI-623 could not tick its own gate criterion and had to
submit with it unticked and a page of evidence attached.

It also hides real failures. Run 1's ten included **one genuine failure**
(`structure.test.ts`'s web-mirror check, a real missing test from LAI-622) in
among nine timeouts. A real red sitting inside a crowd of flaky reds is a red
nobody reads.

## Acceptance criteria

- [ ] The tooling tests do not fail on a loaded machine. A raised
      `testTimeout` for that directory is the obvious fix; making them cheaper
      is the better one where it is easy.
- [ ] Whatever the fix, it is **measured under load**, not on a quiet machine —
      run the suite with something else saturating the CPU and show it green.
      A flake that passes when you check it is not evidence of anything.
- [ ] `build.test.ts`'s SSE shutdown case is looked at separately if its
      failure turns out not to be a budget problem — it reported
      `Error: setup failed: 422` in run 1, which is a different shape.

## Notes / context

- Found by SHELL running the repo-root gate for LAI-623 (CLAUDE.md §5: "the
  gate is the repo-root `pnpm test`, not your workspace's").
- **SHELL has not touched the budget.** Editing `server/`'s vitest config from
  another session's worktree is the crossing §1 forbids, and a flaky guard is
  still a guard.
- Related: LAI-480, on the root gate hiding workspaces — same instrument, a
  different way of not reporting what it saw.
