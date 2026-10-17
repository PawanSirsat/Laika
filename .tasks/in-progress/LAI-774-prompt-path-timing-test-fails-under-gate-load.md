---
id: LAI-774
title: 'The hook''s "≤ 5 ms per prompt" timing test fails in the root gate under load, and passes alone'
area: cli
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-769
status: in-progress
started: 2026-10-17T17:14:01Z
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

- [ ] The check still fails if the prompt path forks or reads the network (a
      mutation proves it), and no longer fails because other suites are busy.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Seen once, on a loaded laptop, during LAI-769's gate. Not reproduced alone.
