# recompute-timing — 2026-10-17

One builder on `fix-recompute-timing` (worktree `Laika-recompute-timing`, cut
from `d5ea2565`), on the owner's direct instruction: LAI-779, filed and claimed
here. Test-only. Not pushed, not merged.

## 2026-10-17T18:00:00Z — LAI-779

**What changed**
- server/test/services/estimates.test.ts — *the cost of a recompute*: statements, rows and plan `SCAN`s per recompute, equal on 120 and 1200 finished tasks (line 391); p95 < 50 ms ceiling (424); the 5 ms budget under `LAIKA_PERF=1` (433)
- cli/test/activity-usage.test.ts — `diskWork()` counts stats, listings and bytes read through `node:fs` / `node:fs/promises` (repointed with `syncBuiltinESMExports`); *cheap*: each of 960 transcripts stat'ed once, none read, only the index opened (1246); fastest < 1000 ms ceiling (1268); the 50 ms budget under `LAIKA_PERF=1` (1276)
- .tasks/review/LAI-779-wall-clock-assertions-fail-on-github-runner.md — the census

**Decisions**
- Count the work, not the time: a per-task query adds statements, a read of the project adds rows, an aggregate over an unindexed column adds a `SCAN` to the plan. Each was mutated into `refresh()` and each turned the default test red (1208 vs 128 statements; 1204 vs 124 rows; `[ 'SCAN tasks' ]`). Restored, sha256 `2fc58e75…` before and after.
- The CLI counter patches the builtins rather than injecting an fs into `cli/src`, so the change stays test-only. Mutations of `scan()`: re-read every transcript (816960 bytes vs 0), stat each twice, treat every file as changed — all red. Restored, sha256 `38194031…` before and after.
- The 1200-task seed took 13.6 s with all ten cores loaded, so that test has a 300 s timeout of its own: setup, never what is asserted (the file's own LAI-771 rule).
- `cli/test/activity-usage.test.ts` is SHELL's area: a named crossing on the owner's instruction, recorded in the task file.

**Discovered**
- What the counts cannot see: an aggregate over an index *range* (one row, one statement, a `SEARCH`) — the cold-fit `count` in `fitFor` is one, and correct. The 50 ms ceiling is what stands behind it.
- The census's closest case is `server/web/test/routes/screens/timeline/timeline-derive.test.ts:287` (600 ms bound, 34 ms here, single-shot). At the 6–15× GitHub showed on the usage step it would sit near 500 ms. Not converted (17× here); worth watching.

**Verified**
- `server/test/services/estimates.test.ts` alone, three runs: exit 0 each (36 passed, 1 skipped); with all ten cores busy (`yes > /dev/null` ×10, killed by PID): exit 0.
- `cli/test/activity-usage.test.ts` alone, three runs: exit 0 each (27 pass, 1 skipped); under the same load: exit 0.
- `LAIKA_PERF=1`, each file's budget test: exit 0 here.
- Root gate on the `94fcb6e8` tree, foreground, each to its own file: `pnpm test` 0 (server 2825 passed / 8 skipped; cli 366 pass / 1 skipped; web 2059 pass), `pnpm lint` 0, `pnpm format` 0.

**State**
In .tasks/review/.
