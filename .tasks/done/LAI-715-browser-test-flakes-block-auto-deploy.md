---
id: LAI-715
title: 'Browser-test flakes on GitHub runners now block automatic deploys'
area: web
assignee: strelka
priority: p1
depends-on: []
discovered-from: LAI-714
started: 2026-10-21T12:41:11Z
finished: 2026-10-21T13:52:53Z
status: done
accepted: 2026-10-29T13:57:10Z
---

## Goal

Since D-073, a push to master deploys only if the CI gate is green. The gate
was green on the Mac every time and has been red on GitHub four times in
nine runs, each time on a **different** browser test that passed in the runs either
side. A flaky gate turns "push and it deploys" into "push, then rerun until it
deploys".

## What was seen

| Run | Test | Failure |
| --- | --- | --- |
| 37746769446 | list-view › pages the table rather than drawing every row at once | rows counted the instant the pager drew: `0 !== 50` — **fixed in LAI-714** |
| 37747463851 | plugin-hooks › a URL without a token sends nothing | unhandled `write EPIPE` on the hook's stdin — **fixed in LAI-714** |
| 37750219844 | list-bulk › a viewer gets no checkboxes and a plain pill | `.list-row` waited for, then `count()` was `0 !== 50` |
| 37769873902 | list-view › carries none of the board's chrome | *"the board lost its lanes"* — lane count read before the board drew |
| 37769873902 | sprint-strip › the board does not move when the sprints land | *"the board never rendered"* — a fixed `waitForTimeout(500)` before measuring |
| local, load 39 | list-view › a row opens the task drawer | `waitForURL(/task=/)` timed out; passed on rerun |

The third does **not** reproduce locally under a 6× CPU throttle: a
MutationObserver saw the List go from 0 to 50 rows once and stay, four runs out
of four. So it is not the List blanking. It is a race in how the test reads the
page on a slower machine.

**The suite, not the app.** "a row opens the task drawer" failed on CI attempt 2
of run 37769873902, yet passed 8 of 8 locally alone under an 8× CPU throttle.
The difference is concurrency: `node --test` runs every browser test file at once,
each launching Chromium, on a 4-vCPU runner. A likely lever is
`--test-concurrency` for `test/browser/` in CI. Measure it rather than assume.

## Acceptance criteria

- [x] Sweep `server/web/test/browser/` for the shape all three share — an
      immediate `count()` / `innerText()` after `waitFor()` on a different or
      less specific locator — and make each wait for the state it then
      asserts. Count the sites, without `head`.
- [x] Ten consecutive green gate runs on GitHub with no rerun, recorded with
      their run ids.
- [x] No assertion is loosened: every fixed test still fails against the
      defect it exists to catch (break it once, watch it go red).

## Evidence (strelka, 2026-10-21)

Built on **Strelka**. Commits `5c681df8`..`58963543`, then this one.

### Sweep

- **The shape, as counted.** After a `waitFor()`/`waitForSelector()` or a
  fixed `waitForTimeout()`, before any action or further wait, a read that
  does **not** wait for anything (`count()`, `allInnerTexts()`,
  `allTextContents()`, `isVisible()`, `isHidden()`, `evaluateAll()`,
  `page.evaluate()`, `page.url()`) asserted against a positive state. Reads
  that auto-wait for their element (`innerText`, `textContent`,
  `getAttribute`) were counted only after a fixed sleep. Every
  `waitForTimeout` in the directory was classified too.
- **Census, no truncation.** A scanner over every `.ts` file in
  `server/web/test/browser/`: 1000 read-after-wait/sleep rows in all, of which
  329 non-waiting positive reads, 38 auto-waiting positive reads after a
  sleep, and 149 `waitForTimeout` calls. Those 516 rows were each
  classified by hand, which gave **517 entries: 275 FIX, 242 KEEP** (the scanner
  printed 516 rows; the hand tables list 517).
  KEEP reasons: absence (a slow page cannot
  turn it red), the same state the wait just established, an auto-waiting
  read, a quiet window before an absence, already guarded, a helper
  definition rather than a read, or a relative before/after measurement.
- **Every site changed** — 243 `until()` calls added (several FIX rows share
  one), 20 fixed sleeps replaced; line numbers in the final files:

- `activity-heatmap.test.ts` (2): 172, 300
- `activity-tab.test.ts` (6): 258, 312, 337, 365, 385, 408
- `board-lane-scroll.test.ts` (5): 282, 457, 507, 921, 940
- `board-motion.test.ts` (1): 524
- `board-refresh.test.ts` (1): 289
- `board-sprint-default.test.ts` (1): 307
- `board-sprint-stats.test.ts` (4): 392, 415, 663, 824
- `capacity.test.ts` (6): 50, 327, 336, 435, 436, 437
- `card-anatomy.test.ts` (1): 351
- `card-click.test.ts` (2): 145, 177
- `card-footer.test.ts` (7): 151, 153, 178, 183, 193, 235, 272
- `card-reorder.test.ts` (2): 376, 496
- `column-reorder.test.ts` (3): 221, 519, 552
- `column-statuses.test.ts` (3): 254, 296, 702
- `connect.test.ts` (15): 569, 582, 585, 765, 785, 1081, 1132, 1181, 1204, 1221, 1330, 1640, 1654, 1699, 1727
- `dashboard-card-filters.test.ts` (2): 433, 438
- `dashboard-feed.test.ts` (4): 146, 184, 214, 249
- `dashboard-summary.test.ts` (3): 240, 340, 515
- `developer-insights.test.ts` (3): 173, 244, 296
- `filter-popover.test.ts` (3): 223, 602, 829
- `github-confirm.test.ts` (4): 393, 405, 410, 434
- `harness-query.test.ts` (4): 64, 90, 119, 154
- `list-bulk.test.ts` (3): 224, 296, 298
- `list-create-row.test.ts` (1): 293
- `list-view.test.ts` (8): 183, 203, 257, 390, 396, 441, 1228, 1329
- `meeting-review.test.ts` (12): 163, 167, 202, 222, 251, 252, 278, 316, 343, 389, 414, 449
- `member-profile.test.ts` (11): 457, 867, 1007, 1328, 1517, 1528, 1851, 1894, 1928, 1969, 1997
- `my-day-bulk.test.ts` (10): 74, 80, 83, 164, 172, 177, 630, 678, 716, 738
- `my-day-v2.test.ts` (2): 212, 981
- `my-day.test.ts` (6): 180, 184, 188, 201, 205, 209
- `nav-redirects.test.ts` (1): 69
- `organisation-prices.test.ts` (2): 126, 246
- `organisation-roles.test.ts` (9): 233, 333, 354, 390, 417, 488, 517, 544, 570
- `organisation-tokens.test.ts` (6): 146, 233, 242, 316, 360, 449
- `priority-icons.test.ts` (2): 234, 287
- `review.test.ts` (4): 191, 214, 258, 412
- `slim-list.test.ts` (1): 455
- `space-bar.test.ts` (4): 196, 440, 467, 554
- `space-chrome-compaction.test.ts` (6): 111, 135, 200, 201, 232, 278
- `spaces-sidebar.test.ts` (18): 95, 100, 154, 185, 186, 264, 352, 408, 428, 475, 539, 583, 680, 694, 736, 801, 814, 887
- `sprint-strip.test.ts` (2): 165, 240
- `store-requests.test.ts` (1): 409
- `subtasks.test.ts` (10): 197, 281, 295, 314, 326, 329, 351, 480, 507, 508
- `task-panel-editing.test.ts` (6): 473, 633, 730, 960, 1005, 1169
- `task-panel.test.ts` (11): 219, 221, 306, 408, 431, 465, 564, 589, 605, 622, 637
- `task-size.test.ts` (5): 353, 431, 445, 450, 473
- `task-tokens.test.ts` (3): 654, 781, 792
- `timeline-sprints.test.ts` (6): 394, 592, 945, 968, 995, 1219
- `unlisted.test.ts` (5): 105, 109, 141, 238, 261
- `usage.test.ts` (2): 592, 683
- `view-settings.test.ts` (4): 132, 246, 248, 267

- **Found outside the census, same defect, fixed:** dashboard-summary's
  *"the four stat cards"* failed live during the sweep (`done NaN !== 21`);
  my-day-v2's *"a font wider than ours … never cut"* failed 2 of 6 local runs
  (`1440 folded=false: cut`), measuring before the layout re-chose the label;
  connect's count after `fill('kiro')`.
- Both named CI failures are covered: list-bulk *"a viewer gets no
  checkboxes"* and list-view *"carries none of the board's chrome"*.

### No assertion loosened

- `git diff` removes 8 `assert` lines and adds 8 with the same locator,
  expected value, operator and message (re-expressed through a local); no
  timeout was changed.
- **One mutation per fixed test**: each simulated the defect
  inside its own test file (a fixture short by one, a DOM element removed, a
  style that cuts or overflows, a write aborted), was proved landed by a
  marker grep or a sha change before its red was trusted, went red **on the
  guarded assertion** in that test, and was restored by sha. Three first
  tries did not simulate the defect and were redone: the my-day-v2 anchor
  matched nothing (`ANCHOR FAILED`); a 4px label box let the app choose its
  empty form; a DOM reorder was redrawn by React. The redone mutations went
  red with `1440 folded=false: cut` and `the rows moved: Laika Core,Laika
  Web,Laika Infra -> Laika Web,Laika Core,Laika Infra`.

### Concurrency, measured (`node --test --test-concurrency=N "test/browser/*.test.ts"`, 797 tests, this 14-core laptop)

| code | N | load alongside | result | wall |
| --- | --- | --- | --- | --- |
| before | 13 (default) | — | 797/797 | 74s |
| before | 3 | — | 797/797 | 149s |
| before | 1 | — | 797/797 | 415s |
| after | 13 | — | 797/797, twice | 73s, 73s |
| after | 3 | — | 797/797, twice | 143s, 145s |
| after | 1 | other sessions, load 31–49 | 797/797 | 631s |
| after | 13 | root `pnpm test` at once | 797/797 | 111s |
| after | 3 | root `pnpm test` at once | 797/797 | 343s |

Concurrency moved wall time, never a result: no setting produced a failure
before or after, and the failures were reads made too early, which a lower
concurrency only hides by making the page faster than the read. So
`--test-concurrency` is **not** changed. GitHub's 4-vCPU runner already
defaults to 3 files at once (`availableParallelism() - 1`), and `pnpm -r`
runs `server/` and `cli/` beside it. Lowering it would cost wall time on
every push for nothing measured.

### Gate (repo root, after the last code edit)

`pnpm test` TEST 0 · `pnpm lint` LINT 0 · `pnpm format` FMT 0 —
server 3386 passed / 10 skipped, server/web 2690/2690, cli 533 / 0 fail.

### Ten GitHub runs

Dispatched one at a time with `gh workflow run deploy.yml --ref
LAI-715-browser-test-flakes` against this commit, the final head, each
watched to the end before the next. Their ids are in the pull request:
writing them here would change the commit they ran against.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #12.
