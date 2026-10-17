---
id: LAI-774
title: 'The hook''s "≤ 5 ms per prompt" timing test fails in the root gate under load, and passes alone'
area: cli
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-769
status: review
started: 2026-10-17T17:14:01Z
finished: 2026-10-17T17:32:15Z
---

## Goal

`cli/test/activity-hook.test.ts` — *"cost of the prompt path"* › *"≤ 5 ms per
prompt (fastest of 41; or ≤ 2× the bare interpreter)"* — failed in the root
`pnpm test` on 2026-10-17 while all three workspaces ran at once, and passed
on an immediate run of that file alone, same tree, the hook script untouched:

```
root gate:  fastest 7.90 ms (bare 3.77), median 13.79 ms (bare 5.10)
            | fastest 10.98 ms (bare 4.51), median 28.89 ms (bare 6.35)
            | fastest 12.31 ms (bare 3.89), median 48.33 ms (bare 7.24)   → EXIT 1
alone:      ok 4 - ≤ 5 ms per prompt                                     → EXIT 0
```

`pnpm -r` stops the other workspaces at the first failure, so a timing test
that loses to load costs the whole gate's evidence, not one line.

## Acceptance criteria

- [x] The check still fails if the prompt path forks or reads the network (a
      mutation proves it), and no longer fails because other suites are busy.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Seen once, on a loaded laptop, during LAI-769's gate. Not reproduced alone.

## Submitted (SHELL, 2026-10-17)

**Criterion 2 is not ticked: `pnpm test` exits 1, on failures outside `cli/`
that are already on `master` at 28e9bf98.** `pnpm lint` and `pnpm format`
exit 0. Three root runs, each to its own file, `cli` 365/365 in every one:

```
gate 1  TEST 1   task-file-state.test.ts ×2; migrate.test.ts "0030 closes INSERT OR REPLACE…" Test timed out in 5000ms
gate 2  TEST 1   task-file-state.test.ts ×2 only
gate 3  TEST 1   task-file-state.test.ts ×2; build.test.ts "built server never became healthy on port 52993"
```

The two that fail every time:

```
a task file carries the fields its state requires > records when it was started once it has been claimed
+   ".tasks/done/LAI-775-tokens-from-automated-sessions.md is in done/ and has no started",
… > records when it was finished once it has been submitted
+   ".tasks/done/LAI-775-tokens-from-automated-sessions.md is in done/ and has no finished",
```

`git show master:.tasks/done/LAI-775-…` has neither field (accepted in
28e9bf98). That is CHIEF's file; nothing on this branch touches it. The other
two are server timing under load ~20, a different one each run.

**What changed.** `cli/test/activity-hook.test.ts` only; the hook is
untouched. Two new structural tests (zsh): the prompt path run as installed
under `ulimit -u 1` must exit 0 with its line written; sourced, it may load
`zsh/datetime` and `zsh/system` beyond an empty script's modules and nothing
else. Each has a positive control. The timing test now pairs each hook run
with a floor script (same drain, clock, read and append) in alternating
order: ≤ 5 ms fastest of 41, or median pair ≤ 2× the floor.

**Mutations** (inserted beside the prompt path's `printf`, anchor checked,
hook restored by checksum): `/usr/bin/true`, `git rev-parse`, `curl
127.0.0.1:9`, `zmodload zsh/net/tcp && ztcp`, a `$(…)` after the write, and a
20 000-step builtin loop. All six red; unmutated green.

**LAI-769 did not slow the prompt path.** Hook at 2eabf5a3 against now,
alternating, 123 runs each under `zsh -f`: 2.71/2.89 ms fastest in one order,
2.90/2.79 and 2.75/2.79 reversed. That's noise within ±0.15 ms.
