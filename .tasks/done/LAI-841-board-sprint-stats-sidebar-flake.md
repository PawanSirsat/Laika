---
id: LAI-841
title: 'Flaky in CI: board-sprint-stats "920px, S2, Dark: search keeps 120px" finds the sidebar closed'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-830
status: done
started: 2026-10-21T05:37:45Z
finished: 2026-10-21T07:27:32Z
accepted: 2026-10-21T11:17:41Z
---

## Goal

`server/web/test/browser/board-sprint-stats.test.ts:641` ("the sidebar open,
the row crowded (LAI-727 review)") passes reliably, with no flakes.

On 2026-10-21, GitHub run 39497695287 (the LAI-830 release) failed the gate on
one subtest. The other seven cases of the same suite passed in the same run, a
re-run of the failed job was green, and the root gate on the same commit
passed locally.

```
not ok 6 - 920px, S2, Dark: search keeps 120px
  location: board-sprint-stats.test.ts:645:14
  error: the sidebar is not open — the wrong state
  false !== true   (board-sprint-stats.test.ts:660:20)
```

A failure that comes and goes on one case looks like a race between setting
the sidebar's state (stored preference or click) and reading it, or state
leaking between cases.

## Acceptance criteria

- [x] Find the cause and name it in this file, with the evidence. Do not
      guess.
- [x] Fix the test setup, or the app if the app is wrong, so the case waits
      for the sidebar state it asserts on and the cases do not share state.
- [x] The suite passes 20 times in a row locally, and once under extra CPU
      load.
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Investigation

Implemented on the owner's direct instruction, as CHIEF's dispatched builder,
in `Laika-sprint-stats-flake` on `LAI-841-sprint-stats-flake`, based on
`d36d2ee5`. No application change is needed.

**Cause: the sidebar setup accepts the pre-resize expanded state before the
1180px media-query change reaches React.** The original crowded-row setup
resized a fresh 1280px page to 920/1024px, then `openSidebar` read the toggle
once and skipped its click if it was still expanded. Its width-only wait
could immediately accept the old 212px sidebar. The later media change
correctly collapses it, so the toolbar measurement finds a closed sidebar.

Source evidence (base `d36d2ee5`):

- `server/web/test/browser/board-sprint-stats.test.ts:653-656` resizes after
  navigation; `:893-900` reads the toggle once, then waits only for width.
- `server/web/src/components/AppShell.tsx:32-44` receives media changes
  asynchronously; `:58-65` resets the narrow-window opening on band changes.
- `server/web/src/components/sidebar/sidebar-state.ts:22` sets the band at
  1180px; `:51-52` collapses narrow windows unless opened explicitly. There
  is no breakpoint at 920px: it is inside the 901–1180 desktop rail band.

**Controlled reproduction, not an inferred timing story.** A temporary
`server/web/test/browser/lai841-probe.ts` used the file’s base fixture
and harness.
Before navigation, its init script wrapped only the
`(max-width: 1180px)` MediaQueryList change listeners, queuing their callbacks
until explicitly released. After resizing to 920px it waited for one queued
callback, ran the original helper unchanged, printed state, then delivered
that callback. It reproduced `the sidebar is not open — the wrong state`,
`false !== true`. The command was:

```sh
pnpm --filter @laika/web exec node --test test/browser/lai841-probe.ts
```

It exited **1**, as expected (one collected case, failed). The first run
was under ten `yes > /dev/null` workers. `/tmp/lai841-controlled.txt` records:

| point | viewport | native narrow query | expanded | width | sidebar preference |
| --- | --- | --- | --- | --- | --- |
| before resize | 1280 | false | true | 212 | null |
| original helper returned, listener held | 920 | true | true | 212 | null |
| listener delivered | 920 | true | false | about 60 | null |

A second controlled run set `page.emulateMedia({ reducedMotion: 'reduce' })`
before navigation, disabling the sidebar transition. It reproduced the same
failure with computed transition duration `0s` and final width exactly 60
(`/tmp/lai841-no-animation.txt`, exit **1**, one failed collected case).
Thus the animation can expose intermediate geometry but is not required for
this failure. These probes controlled event ordering, using no sleep.
Both temporary probe files and instrumentation were removed.

**Other candidates checked:**

- No storage write/read race: the stored preference stayed `null` throughout
  the reproduction, and the original helper skipped the click. Storage is
  read synchronously at mount (`AppShell.tsx:54-57`), and a narrow toggle
  does not persist a choice (`sidebar-state.ts:65-69`).
- No cross-case page/storage leak: `harness.ts:625` calls
  `browser.newPage()` for each case, and `:635-636` closes its owned context
  and stub server. Only the browser process/build is shared. The corrected
  helper also asserts a fresh case has no stored sidebar preference.
- The idle baseline passed: `pnpm --filter @laika/web exec node --test
  test/browser/board-sprint-stats.test.ts`, exit **0**, 38 collected cases.
  Exploratory repeated crowded-row runs under CPU load also passed; a
  naturally scheduled failure was not observed locally. The controlled
  ordering probe above supplies the failing mechanism evidence.

**Specificity check:** temporarily omitting the corrected helper's click
made the exact target fail in its expanded-state/width wait. Command:

```sh
pnpm --filter @laika/web exec node --test --test-name-pattern='920px, S2, Dark' test/browser/board-sprint-stats.test.ts
```

Exit **1**, one collected case failed at `openSidebar`; restored from the
saved fixed file by an EXIT trap and verified byte-for-byte before repeats.
The original explicit `m.railOpen` positive control and all search-width,
member-pile, active-group and fit assertions remain.

## Verification commands and collected cases

All commands below ran at the assigned worktree root. The implementation
was unchanged throughout the repeated and loaded runs; it still matches
`/tmp/lai841-fixed.test.ts` byte-for-byte. Counts are collected test cases,
not test functions.

```sh
pnpm install
# exit 0
pnpm --filter @laika/web typecheck > /tmp/lai841-typecheck.txt 2>&1
# exit 0

for run in {1..20}; do
  pnpm --filter @laika/web exec node --test test/browser/board-sprint-stats.test.ts > "/tmp/lai841-repeat-${run}.txt" 2>&1
  task_run_exit=$?
  echo "REPEAT $run EXIT $task_run_exit"
  if (( task_run_exit != 0 )); then
    cat "/tmp/lai841-repeat-${run}.txt"
    exit "$task_run_exit"
  fi
done
```

The loop exited **0**. Every line from `REPEAT 1 EXIT 0` through
`REPEAT 20 EXIT 0` reported 0: **20/20 consecutive full-file runs**, each
**38 passed, 0 failed, 0 cancelled, 0 skipped**, across 13 suites.
That is 760 collected case executions, including all eight crowded-row
cases in each run. No retry-on-failure wrapper was used; a failure would
have stopped the loop.

The additional load-run wrapper was:

```sh
task_load_pids=()
for i in {1..4}; do
  yes > /dev/null &
  task_load_pids+=($!)
done
printf 'LOAD PIDS %s\n' "${task_load_pids[*]}"
trap 'kill ${task_load_pids[@]} 2>/dev/null; wait ${task_load_pids[@]} 2>/dev/null' EXIT
trap 'exit 130' INT TERM
pnpm --filter @laika/web exec node --test test/browser/board-sprint-stats.test.ts > /tmp/lai841-load.txt 2>&1
task_run_exit=$?
echo "LOAD EXIT $task_run_exit"
tail -12 /tmp/lai841-load.txt
exit "$task_run_exit"
```

Verbatim output (summary):

```text
LOAD PIDS 66049 66050 66051 66052
LOAD EXIT 0
# tests 38
# suites 13
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 119744.7525
```

**1/1 additional full-file run under four deliberate CPU workers**, exit 0.
The trap killed only those PIDs and waited for them. A subsequent
`ps -p 66049,66050,66051,66052 -o pid,command` printed only its header,
confirming none remained. The earlier ten-worker investigation used PIDs
21772 through 21781; all were also checked absent. No manual development
server was started; browser fixtures own their loopback stub servers and
OS-assigned ephemeral ports, closed by `h.close()`. No request was made to
localhost:3000 or production.

## Root gate history and isolated reruns

Two early root gate runs were red outside this change. Each gate command
ran unpiped, with its own output file and status. These are not reported
as green.

First run, verbatim status lines:

```sh
pnpm format:fix > /tmp/lai841-pre-review-format-fix.txt 2>&1; echo "FORMAT_FIX $?"
pnpm test > /tmp/lai841-pre-review-gate.txt 2>&1; echo "TEST $?"
pnpm lint > /tmp/lai841-pre-review-lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/lai841-pre-review-fmt.txt 2>&1; echo "FMT $?"
```

```text
FORMAT_FIX 0
TEST 1
LINT 0
FMT 0
```

Verbatim failing test excerpt:

```text
server test:  ❯ test/tooling/build.test.ts (16 tests | 1 failed) 247375ms
server test:      × produces an identical tree on a second run with no clean between 130757ms
server test:  FAIL  test/tooling/build.test.ts > the build is idempotent (LAI-028) > produces an identical tree on a second run with no clean between
server test: Error: Test timed out in 120000ms.
server test:  ❯ test/tooling/build.test.ts:181:3
server test:  Test Files  1 failed | 164 passed | 2 skipped (167)
server test:       Tests  1 failed | 3374 passed | 10 skipped (3385)
```

Its isolated rerun, command and verbatim result:

```sh
pnpm --filter @laika/server exec vitest run test/tooling/build.test.ts > /tmp/lai841-build-rerun.txt 2>&1; echo "BUILD_RERUN $?"
```

```text
BUILD_RERUN 0
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  11:47:09
   Duration  148.21s (transform 1.06s, setup 0ms, import 1.52s, tests 143.04s, environment 1ms)
```

Second root run (after that isolated rerun):

```sh
pnpm format:fix > /tmp/lai841-retry-format-fix.txt 2>&1; echo "FORMAT_FIX $?"
pnpm test > /tmp/lai841-retry-gate.txt 2>&1; echo "TEST $?"
pnpm lint > /tmp/lai841-retry-lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/lai841-retry-fmt.txt 2>&1; echo "FMT $?"
```

```text
FORMAT_FIX 0
TEST 1
LINT 0
FMT 0
```

It reported these untouched migration tests before pnpm bailed on CLI:

```text
server test:  ❯ test/db/project-statuses.test.ts (22 tests | 2 failed) 111478ms
server test:      × survives every project at once, clashes and all, with nothing dangling 10548ms
server test:      × gives a project with no columns at all the six defaults, as it was already drawing them 13286ms
cli test:     not ok 4 - a sync that hangs is abandoned at its deadline, and writes nothing after
cli test:       location: '/Users/pawangajanansirsat/Documents/GitHub/KvellDynamics/Laika-sprint-stats-flake/cli/test/activity-sync.test.ts:677:8'
cli test:         TestContext.<anonymous> (file:///Users/pawangajanansirsat/Documents/GitHub/KvellDynamics/Laika-sprint-stats-flake/cli/test/activity-sync.test.ts:708:14)
cli test: # tests 535
cli test: # pass 532
cli test: # fail 1
cli test: # skipped 2
```

The CLI assertion saw `failures: 2`, next sync at 1792052400 rather than
`failures: 1`, next sync at 1792051800: the late failure write already
tracked by LAI-801. The migration errors were not printed before the
workspace run bailed; their long durations suggest a timeout but do not
prove it. The task filing preserves that uncertainty.

Both files were rerun alone, with no edits:

```sh
pnpm --filter @laika/server exec vitest run test/db/project-statuses.test.ts > /tmp/lai841-statuses-rerun.txt 2>&1; echo "STATUSES_RERUN $?"
pnpm --dir cli exec node --test test/activity-sync.test.ts > /tmp/lai841-activity-sync-rerun.txt 2>&1; echo "ACTIVITY_SYNC_RERUN $?"
```

```text
STATUSES_RERUN 0
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  11:57:29
   Duration  3.63s (transform 186ms, setup 0ms, import 613ms, tests 2.80s, environment 0ms)
ACTIVITY_SYNC_RERUN 0
# tests 43
# suites 11
# pass 43
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 59289.685209
```

The runner was then interrupted. On resume, no task processes or CPU
workers remained; these logs were complete and were read before doing any
further work. A fresh root gate follows these isolated reruns.

## Discovered work

- **LAI-846**, `.tasks/backlog/LAI-846-my-day-browser-sidebar-state.md`:
  sibling resize-then-read setup in
  `server/web/test/browser/my-day-v2.test.ts:907-923`, `:955-969`,
  `:1025-1039` (base `d36d2ee5`). Each reads the toggle once after a
  1440-to-1024 breakpoint-crossing resize; if no click is made, it never
  waits for the intended state. If clicked, it waits on the attribute alone,
  not the final width. Filed one task; sibling files were left unchanged.
- **LAI-847**, `.tasks/backlog/LAI-847-build-idempotence-test-time-bound.md`:
  the unrelated build test's evidenced 120-second timeout under contention.
- **LAI-848**,
  `.tasks/backlog/LAI-848-project-status-migration-tests-under-load.md`:
  investigate the migration failures above; mechanism remains unconfirmed.
- **LAI-801** already tracks the CLI abandonment bug; no duplicate filed.

Each new ID came from the complete section 3 union (current ls-tree over
all local branches, all task-path history, all commit subjects). The union
was repeated immediately before staging each new task. Earlier snapshots
suggested lower free IDs; fresh sweeps correctly skipped IDs other builders
had taken in the meantime.

### Resumed root run and My day isolated rerun

The root run after resuming used the required commands and paths:

```sh
pnpm format:fix > /tmp/lai841-format-fix.txt 2>&1; echo "FORMAT_FIX $?"
pnpm test > /tmp/lai841-gate.txt 2>&1; echo "TEST $?"
pnpm lint > /tmp/lai841-lint.txt 2>&1; echo "LINT $?"
pnpm format > /tmp/lai841-fmt.txt 2>&1; echo "FMT $?"
grep -E "Unhandled|Errors|Failed|not ok|✗" /tmp/lai841-gate.txt
```

The test command exited **1** on this untouched My day case (the logs are
preserved as `/tmp/lai841-third-*.txt` before the next root gate):

```text
server/web test:     not ok 3 - a font wider than ours: a gap, a break, a block’s figures and the week’s are never cut
server/web test:       location: '/Users/pawangajanansirsat/Documents/GitHub/KvellDynamics/Laika-sprint-stats-flake/server/web/test/browser/my-day-v2.test.ts:950:8'
server/web test:         1440 folded=false: cut
server/web test:         +   'dayline-block-sub: 1:00–2:50 PM · 1 h 50 min'
server/web test:         TestContext.<anonymous> (file:///Users/pawangajanansirsat/Documents/GitHub/KvellDynamics/Laika-sprint-stats-flake/server/web/test/browser/my-day-v2.test.ts:977:18)
```

The complete file alone, command and verbatim result:

```sh
pnpm --filter @laika/web exec node --test test/browser/my-day-v2.test.ts > /tmp/lai841-my-day-rerun.txt 2>&1; echo "MY_DAY_RERUN $?"
```

```text
MY_DAY_RERUN 0
# tests 31
# suites 14
# pass 31
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 57544.943959
```

The observation is appended to LAI-846 without claiming that its cause is
the sidebar/media race; this failure happened at 1440px. No sibling code
was changed. The next root gate follows this isolated file rerun.

Third run, verbatim status lines: `FORMAT_FIX 0`, `TEST 1`, `LINT 0`,
`FMT 0`. **Corrected at handover:** this line said the root log contains
only the My day failing case above. It does not. The server workspace had
already marked build idempotence failed when pnpm bailed on web, so no
server summary printed, and only the case's line survives
(`/tmp/lai841-third-gate.txt:18397`). That makes it the third root gate
this case failed, recorded on LAI-847:

```text
server test:  ❯ test/tooling/build.test.ts (16 tests | 1 failed) 458695ms
server test:      × produces an identical tree on a second run with no clean between 194554ms
```

The log's other `not ok` (`not ok 398 - a phone, and both themes (I)`,
`my-day-v2.test.ts:869`) is the parent suite of the My day case, not a
second failure.

### Fourth root gate and resource setting for subsequent verification

The next root gate used the same required commands and output paths. Its
logs are preserved as `/tmp/lai841-fourth-*.txt`. Verbatim statuses:

```text
FORMAT_FIX 0
TEST 1
LINT 0
FMT 0
```

Verbatim failing excerpt:

```text
server test:  ❯ test/tooling/build.test.ts (16 tests | 1 failed) 366737ms
server test:      × produces an identical tree on a second run with no clean between 138733ms
server test: Error: Test timed out in 120000ms.
server test:  Test Files  1 failed | 164 passed | 2 skipped (167)
server test:       Tests  1 failed | 3374 passed | 10 skipped (3385)
```

The web workspace passed 2630/2630 collected cases; CLI passed 533 with
2 intentional skips and no failures. The shared machine's load peaked
above 60 while other builders also compiled. The build timeout finding
was appended to LAI-847. The complete file is rerun alone again:

```sh
pnpm --filter @laika/server exec vitest run test/tooling/build.test.ts > /tmp/lai841-build-rerun-2.txt 2>&1; echo "BUILD_RERUN_2 $?"
```

For subsequent root gates, the builder explicitly sets:

```sh
export VITEST_MAX_WORKERS=2
```

The installed Vitest code confirms this option sets `maxWorkers`. This
bounds its process pool on a machine shared by four builders. The root
`pnpm test` command and pnpm's parallel workspace execution stay unchanged:
all tests still run, and neither assertions nor timeouts are changed.
The original default gates and every failure above remain recorded. The
20-run and deliberate-load proof used the normal environment, before this
setting; this setting is only for the subsequent root gates.

Second isolated build-file rerun, verbatim result:

```text
BUILD_RERUN_2 0
 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  12:36:16
   Duration  22.12s (transform 39ms, setup 0ms, import 57ms, tests 21.98s, environment 0ms)
```

### Fifth root gate (`VITEST_MAX_WORKERS=2`): green

Same commands and output paths as the fourth, after
`export VITEST_MAX_WORKERS=2`. The tree was HEAD `5114a6f7` plus the
uncommitted Markdown in this file, LAI-846 and LAI-847, all last edited
at 12:37:34 local, before `pnpm test` started. The run took 12:37 to 12:54
local (07:07 to 07:24Z). Verbatim, from `/tmp/lai841-gate-exits.txt`:

```text
TEST 0
LINT 0
FMT 0
```

Workspace summaries from `/tmp/lai841-gate.txt`, each the full line:

```text
cli test: # tests 535
cli test: # pass 533
cli test: # fail 0
cli test: # skipped 2
server/web test: # tests 2630
server/web test: # pass 2630
server/web test: # fail 0
server test:  Test Files  165 passed | 2 skipped (167)
server test:       Tests  3375 passed | 10 skipped (3385)
```

`grep -E "Unhandled|Errors|Failed|not ok|✗"` matched two lines, both the
name of a passing test (`ok 127 - completeSetup and fieldErrors`), which
matches `Errors`. `pnpm lint` printed only its banner. `pnpm format`
printed `All matched files use Prettier code style!`. `pnpm format:fix`
reported the one changed file `(unchanged)`. Its own `$?` went to the
interrupted builder's terminal and was not preserved, so it is not
claimed here. The 1-minute load was not sampled at the start. It was
61.17 at 07:12:58Z, then 49.93, 40.42, and 31.98 at about 07:24Z.

## Handover and independent verification

The Codex builder stopped at its usage limit while the fifth gate was
running. A Claude Code session, also dispatched by CHIEF on the owner's
instruction, finished the task in the same worktree. **It changed no
code.** `5114a6f7` is Codex's commit, unchanged. The handover session
waited for the fifth gate rather than killing it. It did not run Codex's
`/tmp/lai841-finalize.py`, because that script writes a green gate into
this file without checking which run produced it.

What was checked, and how:

- **The diff against the criteria.** Viewports are set in `open`'s
  `before` hook, which runs on a fresh `browser.newPage()` before
  `page.goto` (`harness.ts:625-627`). So `useMedia` reads the narrow query
  at mount (`AppShell.tsx:33`), and no change event is in flight.
  `openSidebar` now requires `aria-expanded=false` and a 60px rail
  *before* clicking, then `aria-expanded=true` and 212px after. A late
  media change would therefore be waited out, not accepted. Neither wait
  can pass on the old pre-resize layout. There is no sleep and no retry,
  and every assertion is intact: `m.railOpen`, the face pile, the search
  width and `assertFitsOpenAndClosed` are untouched. The third caller
  (`sidebar open: members, sprints and counts land without a shift`)
  already set its viewport in `before`. The move also put the `settled`
  doc comment back above `settled`, where the old helper had orphaned it.
- **The evidence files.** `/tmp/lai841-fixed.test.ts` is byte-identical
  to the committed test file, and `/tmp/lai841-original.test.ts` to base
  `d36d2ee5`. Every repeat file, `/tmp/lai841-repeat-1.txt` through
  `-20.txt`, reads `# tests 38`, `# pass 38`, `# fail 0` with no pnpm
  error, as does `/tmp/lai841-load.txt`. The repeats ran at 11:14–11:29
  and the load run at 11:31, all after the fixed file was saved (11:14:02).
  `/tmp/lai841-controlled.txt` and `/tmp/lai841-no-animation.txt` show the
  held-listener states in the table above, and both fail on
  `the sidebar is not open — the wrong state`.
- **The mutation's limit.** `/tmp/lai841-mutation.txt` (the click omitted)
  fails in the post-click wait (`:904`), which proves that wait can fail
  and nothing more. The race itself is shown by the controlled
  reproduction against the *original* helper. No mutation re-ran the
  probe against the new helper, because the new flow has no resize after
  navigation for the probe to hold.
- **The file, five more times**, from `server/web`, sequentially, one
  output file per run, load 25 to 29:

  ```sh
  node --test test/browser/board-sprint-stats.test.ts
  ```

  ```text
  RUN 1 EXIT 0
  RUN 2 EXIT 0
  RUN 3 EXIT 0
  RUN 4 EXIT 0
  RUN 5 EXIT 0
  ```

  Each run: 38 collected cases, 38 passed, 0 failed, 16.5–17.9s. In every
  run, each of the twelve cases that call `openSidebar` read `ok`: eight
  crowded-row, two pill and two sidebar-open.
- **The red gates, as a census.** Each red log was grepped in full for
  `not ok` and `×`. The first, second and fourth match their records
  above. The third did not, and is corrected above. No gate log contains
  a failure in `board-sprint-stats.test.ts`.

### Final-tree gate attempts (after the review move)

Each run had a clean tree and `VITEST_MAX_WORKERS=2`, with each
command redirected to its own file in the handover session's scratchpad,
each `$?` captured on its own.

1. **07:46Z on `11649cea`, interrupted, no result.** It started at a 1-minute
   load of 22.52. The poll that cleared it read 17.70 at 07:46:24Z, and the
   load rose in the 14 seconds before the script took its own sample. The
   session's runner was interrupted at about 07:53Z, which killed the shell
   (exit 144) mid-`pnpm test`. CLI had finished (533 passed, 0 failed) and
   web had finished (2630 passed, 0 failed). The server workspace had printed
   no file result, so pnpm's closing `ELIFECYCLE Test failed` reports the
   killed child. Lint and format never ran, so this run counts for nothing
   either way.
2. **08:22Z on `11649cea`, red: `TEST 1`, `LINT 0`, `FMT 0`.** The pre-start
   check read 19.07, and the script's own sample at start read 20.22. The
   load rose to 63 while web ran. The run was detached with `nohup` this
   time, so a runner interruption could not end it. The only failure was the
   My day wider-font case already recorded on LAI-846, which failed
   identically in the third gate:

   ```text
   server/web test:     not ok 3 - a font wider than ours: a gap, a break, a block’s figures and the week’s are never cut
   server/web test:         1440 folded=false: cut
   server/web test:         +   'dayline-block-sub: 1:00–2:50 PM · 1 h 50 min'
   server/web test: # tests 2630
   server/web test: # pass 2629
   server/web test: # fail 1
   ```

   pnpm bailed on web, so **the server suite did not run** (five
   `server test:` lines, typecheck and the vitest banner only). CLI passed
   533 with 0 failed. All twelve board-sprint-stats `openSidebar` cases
   read `ok`. The file alone straight after, at load 23:

   ```sh
   pnpm --filter @laika/web exec node --test test/browser/my-day-v2.test.ts
   ```

   It exited 0, with 31 collected cases, 31 passed and the wider-font case
   `ok`. The second occurrence and a labelled lead are appended to LAI-846.
3. **08:33Z on `7cc8a924`, red: `TEST 1`, `LINT 0`, `FMT 0`.** It started
   the moment a 60-second poll read 17.26, and its own sample at start
   read the same. The load reached 77.62 by the end of `pnpm test`. The
   only failure was a different case outside this change:

   ```text
   server/web test:     not ok 1 - clicking the card body — not the key — opens the panel
   server/web test:         locator.waitFor: Timeout 15000ms exceeded.
   server/web test:         - waiting for locator('article.card').first() to be visible
   server/web test: # tests 2630
   server/web test: # pass 2629
   server/web test: # fail 1
   ```

   pnpm bailed on web again, so the server suite did not run. CLI passed
   533 with 0 failed. All twelve board-sprint-stats `openSidebar` cases read
   `ok`. Alone straight after, at load 35:
   `pnpm --filter @laika/web exec node --test test/browser/card-click.test.ts`,
   exit 0, 2 collected cases passed. Filed as **LAI-857**. With no other
   builder's tests running, this machine sat at a load of 17 to 30, with
   Spotlight and Microsoft Defender using about 340% CPU between them.
   During each gate the load reached 60 to 77, so a load under 20 at the
   start does not mean low load during the run.

## Result

**Cause:** the old setup resized after navigation and accepted the
pre-resize 212px sidebar before React received the 1180px media-query
change. The change then collapsed the sidebar to 60px. A controlled
reproduction proves this ordering, holding the listener with transitions
on and with them off. Storage stayed `null`, and each case gets its own
context, so neither a storage race nor shared state explains it.

**Fix:** `5114a6f7`, test setup only. The viewport is chosen before
navigation, and the helper waits for the collapsed rail, asserts no
stored preference, clicks once, and waits for the expanded state at its
final width. No application code changed.

**Proof:** 20/20 consecutive full-file runs and 1/1 under four `yes`
workers (Codex), then 5/5 more (handover). Every run had 38 collected
cases, 38 passed, and exited 0.

**Gate:** the fifth root gate above, `TEST 0`, `LINT 0`, `FMT 0`, with
`VITEST_MAX_WORKERS=2`, on code identical to this branch's final code.
Only Markdown changed after it. The four default-pool runs before it
exited `TEST 1`, each failing only in files this change does not touch.
Of the final-tree attempts above, one was interrupted, one was red only
in the My day case (LAI-846) and one only in card-click (LAI-857). Every
failing file passed alone. The root gate is run again on the final tree
before push. Its exit codes are on the PR and the card (LAIKA-632) rather
than here, because writing them here would be an edit after the gate.
