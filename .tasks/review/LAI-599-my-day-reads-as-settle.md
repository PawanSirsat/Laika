---
id: LAI-599
title: 'web: my-day "a typed length says what it understood" read 1 h 45 min for 1h 30m on CI'
area: shell
assignee: chief
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-830
status: review
finished: 2026-10-29T09:32:34Z
started: 2026-10-29T08:49:50Z
---

## Goal

`server/web/test/browser/my-day.test.ts`'s *"a typed length says what it
understood before anything is saved"* failed on the PR #123 run: at `:605`
it expected `Reads as 1 h 30 min` after typing `1h 30m` and read
`Reads as 1 h 45 min`. Since D-073 a red gate on `master` holds the deploy.

## What was seen

| Run | Failure |
| --- | --- |
| PR #123 | `my-day.test.ts:605` — `'Reads as 1 h 45 min' !== 'Reads as 1 h 30 min'` |

**The first guess, to check:** the test reads the screen right after typing
without waiting for it to settle. Prove the cause before changing anything.
`1 h 45 min` is not a value the field ever held on the way to `1 h 30 min`
(the previous one was `45 min`), so a stale read alone does not explain it.

## Acceptance criteria

- [x] The cause is named with evidence: a run that reproduces `1 h 45 min` on
      purpose (CPU throttling, or delaying the update), with the command and
      its output in this file.
- [x] The fix addresses that cause. If the test is wrong, it waits for the
      settled value without loosening what it asserts. If the screen is
      wrong, the screen is fixed and the test is left as strict as it is.
- [x] The fix is shown to matter: undo it and the reproduction goes red; put
      it back and it goes green. Both runs are recorded here.
- [x] Every my-day browser suite still passes, and `pnpm lint` and
      `pnpm format` exit `0`, each captured on its own line.

## Notes

- Filed by Belka (dispatched by polly) from the CI run above.
- Phase 2.5 card, under LAIKA-785. Tags `phase-2-5`, `host-belka`.

## Evidence (Belka, 2026-10-29)

**The first guess was wrong.** The test does not read too early. What it read
was the screen's settled value, and that value was wrong. `1 h 45 min` was
never a value the field held on the way to `1 h 30 min`. **The page
overwrote what was typed.** Waiting longer would have waited for the wrong
value.

**Cause** (`server/web/src/routes/screens/my-day/Wheel.tsx`). Each wheel
column picks the item in its band once it has been still for `SETTLE_MS`
(90 ms). Each scroll arms a timer, and that timer closed over the `index` and
`onPick` of **the render whose scroll armed it**.

Typing `45` scrolls Hours (1→0) and Minutes (35→45), which arms both timers.
`1h 30m` moves Hours back to 1, through `useLayoutEffect` setting `scrollTop`.
If that change lands in the frame before the timer is due, the timer fires
**before** the move's own scroll is delivered. It reads the new `scrollTop`
(row 1) against the old `index` (0), takes that for a pick, and calls the old
`onPick`, which writes `lengthFrom({ ...pos at 45, hours: 1 })`. That is
**`1 h 45 min`**, written into the field.

**Reproductions.**

1. *CPU throttling did not reproduce it.* `Emulation.setCPUThrottlingRate` at
   1×, 4×, 10× and 20×, 5–6 rounds each, gave `pass 6, fail 0` every time,
   because throttling slows timers and frames alike. A 150 ms main-thread
   long task after typing did not reproduce it either: Chrome delivered the
   scroll (at 151 ms) before the overdue timer.
2. *Typing just before the timer is due did.* A scratch test typed `45`,
   waited for the Hours column's scroll, waited *gap* ms, then typed
   `1h 30m`, each on a fresh page:
   - gaps 60/75/80/85 passed and 88 failed;
   - on a rerun, 86–88 passed and 89 failed 3/3;
   - every failure read `"Reads as 1 h 45 min"` with the field holding
     `"1 h 45 min"`.

   The window is about 1 ms wide in headless Chrome. With the fix, gaps 86–91
   gave 10/10 green.
3. *The deterministic form is now the regression test:* *"a length typed while
   the wheel waits to settle is kept as typed (LAI-599)"* in
   `my-day.test.ts`. It holds the wheel's 90 ms settle timers in-page, types
   `45`, and waits for the Hours column's scroll. It then types `1h 30m`,
   waits for the commit to move the column (microtasks only, no frame), and
   fires the held timers: the "timer before scroll" order, every time. The
   setup is checked, so a run in which `45` did not scroll Hours, or the
   column did not move, reports that rather than passing.

**Fix.** The settle timer calls the column's latest `pickAt` through a ref,
updated in a layout effect on every commit. A stale timer finds the column
where the latest render put it and picks nothing; a user's scroll still picks
as before. `Wheel` is used only by `EditorWhen`, so this covers the Start, End
and Length wheels. The original assertion at `:605` is unchanged.

**The fix matters.** Command, in `server/web/`:
`node --test --test-name-pattern="while the wheel waits" test/browser/my-day.test.ts`

| Wheel.tsx | runs | result |
| --- | --- | --- |
| `HEAD` (unfixed) | 3 | **EXIT 1** each time, `{ value: '1 h 45 min' }`, the CI value |
| fixed | 5 | **EXIT 0** each time |

The unfixed file was put back from `git show HEAD:…` and the fixed one from a
saved copy; `grep -c latestPick` read 0 and 3 respectively before each run.

**Suites.** In `server/web/`, `node --test test/browser/my-day*.test.ts`
(21 files) exits 0 with `# tests 159, # pass 159, # fail 0`. `pnpm --filter
./server/web typecheck` exits 0.

**Gate** (in `.polly/wt-599`, after the last edit):

- `pnpm test`: **EXIT 0**. Server `Tests 4199 passed | 10 skipped (4209)`,
  web `# pass 3603, # fail 0` (one more than without this branch: the new
  case), cli `# pass 665, # fail 0`.
- `pnpm lint`: **EXIT 0**.
- `pnpm format`: **EXIT 0**.

**Scope note.** The brief asked for the test to be fixed. The proof shows the
test was right and the screen was wrong, so the fix is in `Wheel.tsx`
(`server/web/`, SHELL's area). This task's area is `shell`, and the change is
confined to that one component. The original assertion is untouched.
