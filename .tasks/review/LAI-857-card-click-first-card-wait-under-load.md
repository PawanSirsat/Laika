---
id: LAI-857
title: 'card-click "clicking the card body opens the panel" times out waiting for the first card in a contended root gate'
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-841
status: review
started: 2026-10-21T16:22:45Z
finished: 2026-10-21T17:00:05Z
---

## Goal

`server/web/test/browser/card-click.test.ts:121` ("clicking the card body —
not the key — opens the panel") does not fail a busy root gate while the
board it opens is healthy. Keep its specific geometry assertions.

## Acceptance criteria

- [ ] Find out, with evidence, where the 32 seconds went when it failed:
      in `open` (build, browser, first navigation) or in the 15000ms wait for
      `article.card`. Record what the page showed when the wait gave up. Do
      not infer it from the durations alone.
- [ ] Fix the cause you found. Keep the title-exists, layout-box and
      `elementFromPoint` checks. Do not add a suite retry or a sleep, and do
      not raise the timeout without a measured reason.
- [ ] The file passes alone, and in a root gate under measured contention.
      `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Evidence

No `server/web/` code other than `board-sprint-stats.test.ts` changed on
LAI-841. This case failed LAI-841's eighth root gate (HEAD `7cc8a924`,
`VITEST_MAX_WORKERS=2`). That gate started at a 1-minute load of 17.26,
which reached 77.62 by the end of `pnpm test`. Verbatim:

```text
not ok 1 - clicking the card body — not the key — opens the panel
  duration_ms: 32207.003041
  location: '…/server/web/test/browser/card-click.test.ts:121:8'
  error: |-
    locator.waitFor: Timeout 15000ms exceeded.
    Call log:
      - waiting for locator('article.card').first() to be visible
  stack: TestContext.<anonymous> (…/card-click.test.ts:125:18)
```

The case took 32.2s, and its wait is bounded at 15s, so about 17s went
before the wait, in `open`. That is arithmetic, not a measurement of where
it went. Web reported 2630 collected cases with 2629 passed. pnpm then
bailed, so the server suite did not run. The file passed alone straight
after, at a load of 35:
`pnpm --filter @laika/web exec node --test test/browser/card-click.test.ts`,
exit 0, 2 collected cases passed, 2.9s.

Context, as an observation only: with no other builder's tests running,
this 10-core machine sat at a load of 17 to 30. Spotlight's `mds_stores`
used about 190% CPU and Microsoft Defender's `wdavdaemon_unprivileged`
about 150%. During a gate the load reached 60 to 77. Across LAI-841's red
gates, a different check failed each time, each passing alone: two 120s
or default time bounds (LAI-847, LAI-848), an overflow read (LAI-846) and
this 15s wait. The search found no existing task for this case. The
only task naming the file is the done LAI-241.

## Note: LAI-715 may explain this (CHIEF, 2026-10-21)

Read **LAI-715** (`.tasks/backlog/`, p1, unclaimed) before starting. It may
be the same cause. Each point below quotes its task file, or the code:

- **Same shape.** LAI-715's gate went red *"each time on a **different**
  browser test that passed in the runs either side"* (its Goal). Only one of
  them is recorded passing **alone**: *"a row opens the task drawer"*,
  which *"failed on CI attempt 2 of run 37769873902, yet passed 8 of 8
  locally alone under an 8× CPU throttle"*. Its conclusion: **"The
  suite, not the app"**, *"The difference is concurrency"*. This case also
  timed out in a root gate (load 17 to 77) and passed alone in 2.9s.
- **Mostly GitHub, once locally.** LAI-715's failures were on GitHub runners,
  except one row of its table: *"local, load 39 | list-view › a row opens the
  task drawer | `waitForURL(/task=/)` timed out; passed on rerun"*. That row
  says only *passed on rerun*, not alone. This case was on the 10-core Mac.
- **The concurrency it names is still there, bounded.**
  `server/web/package.json`'s `test` is
  `pnpm run typecheck && node --test "test/**/*.test.ts"`, with no
  `--test-concurrency`. Node 22.18 then runs at most 9 test files at once:
  `os.availableParallelism()` is 10 on this Mac, minus 1. There are 223
  `*.test.ts` files under `server/web/test/`, 65 of them in `test/browser/`,
  and each browser file launches its own Chromium (`harness.ts:533`, *"One
  browser for the whole file"*). So up to 9 Chromium launches can overlap.
  LAI-715's line *"`node --test` runs every browser test file at once"* is
  wider than that; it is quoted here, not repeated.
- **This case pays its file's launch.** It is the first test in
  `card-click.test.ts`, and `open` (`harness.ts:614`) calls `browser()`,
  whose first call is `chromium.launch` (`harness.ts:535`). So the ~17s
  spent before the 15000ms wait includes a Chromium launch, while up to 8
  other web test files run beside it, and in a root gate the server and CLI
  suites as well: the root `test` is `pnpm -r --if-present run test`, which
  starts all three together. That fits LAI-715's account; it still has to be
  measured, as the first criterion says.

Where it does **not** fit: LAI-715's sweep is for *"an immediate `count()` /
`innerText()` after `waitFor()` on a different or less specific locator"*,
and its fix is to *"wait for the state it then asserts"*. The sweep **would**
find this site: `card-click.test.ts:124-125` waits on `article.card`, then
`:130-131` calls `title.count()` on `.card-title`. But that is not what
failed here. This failure is the `waitFor` at `:125` itself timing out, and
the sweep's fix would not change that wait. If LAI-715's other lever,
`--test-concurrency` for `test/browser/`, turns out to be the fix, take it
under LAI-715, or with it, rather than twice.

## Builder notes (Strelka, 2026-10-21): not reproduced, so not fixed

**Criteria 1 and 2 are not met, and are left unticked on purpose.** The
failure did not reproduce, so there is no cause to fix. What was measured,
and what was shipped instead:

- **Alone:** `node --test test/browser/card-click.test.ts` (in `server/web`),
  exit 0, 2 of 2 cases, about 2.2s. A timed probe of this case's first open:
  `open` took 2221ms (build and browser launch); the first card was visible
  86ms after `open` returned.
- **In a contended root gate** (lock held, base `6b8cd862`): six copies of a
  probe of this case, 3 opens each, ran inside `pnpm test`. The load average
  went from **41.29 at the start to 154.52 at the end** (the 1-minute figure
  from `uptime`, other builders' gates running too). This is about twice the
  77.62 of LAI-841's failing gate. **18 of 18 opens rendered the card.** Each
  file's first open (build, launch, navigation) took **6305 to 7430ms**. The
  card was visible **72 to 429ms** after `open` returned. Later opens took
  under 0.7s in all. Web reported `# tests 2696`, `# pass 2696`, so
  `card-click.test.ts` passed there too.
- **Is it a slow answer?** `SESSION_TIMEOUT_MS` (8000,
  `src/api/session-state.ts:36`) is the only timer on the startup path. With
  `/api/v1/me` held back 7000ms and 9000ms by a `page.route`, the board
  recovered both times. The card was visible 0.3s after `/me` answered. A late
  session does not leave the board stuck.
- So when the wait gave up on Belka, the page was in a state none of these
  runs produced. It was not slow rendering under CPU load, and not a late
  `/me`. Belka differs from this machine: 10 cores, Defender and Spotlight
  scanning the worktrees and the fresh `laika-web-*` build, and several root
  gates at once.

**Shipped (`2c039030`): the wait now reports its own evidence.** If
`card.waitFor` at `:125` gives up, the error names how long `open` took, the
URL, the first 400 characters of `main`'s text and every API call made, with
the Playwright timeout as its `cause`. No timeout, retry or sleep changed, and
the title, layout-box and `elementFromPoint` checks are untouched. Mutation:
point the locator at `article.card-MUTATED` (wait cut to 2s for the run).
The case went red with `no card after open took 1018ms;
http://127.0.0.1:53522/board?project=laika-core showed: Laika Core OFFLINE …
TO DO 2 …; api calls: GET /api/v1/me, …`. Restored, and the file's checksum
matched the original (`19e466e7`).

**Root gates on this branch.** The first, at `92e2da81` (1-minute load 21.07
at the start, 45.81 when `pnpm test` ended), went `TEST 1`, `LINT 0`, `FMT 0`.
`card-click.test.ts` passed in it. One unrelated browser case failed:
`task-markdown.test.ts:226`, a 5000ms wait for a link's popup, and that file
passed alone straight after, 4 of 4. That failure is filed as **LAI-307**. The
gate after the filing is recorded in `logs/strelka-2026-10-21.md` and on the
PR.

**For the reviewer:** accept this as the instrument, so the next red gate
records criterion 1's evidence, or send it back. LAI-715 (PR #12) edits this
file at `:136-148` and `:174`, not this wait. The hunks are near each other
but separate.
