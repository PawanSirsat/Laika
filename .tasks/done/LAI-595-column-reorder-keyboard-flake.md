---
id: LAI-595
title: 'web: column-reorder "the keyboard reaches them with no pointer at all" flakes on GitHub runners'
area: shell
assignee: strelka
priority: p2
parent: LAIKA-785
depends-on: []
discovered-from: LAI-583
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-29T09:26:58Z
finished: 2026-10-29T09:33:00Z
---

## Goal

`server/web/test/browser/column-reorder.test.ts`'s *"the keyboard reaches
them with no pointer at all"* failed twice on GitHub runners in one evening
and passed on the rerun each time. It passed 3/3 locally. Since D-073 a red
gate on `master` holds the deploy, so a flake here turns "push and it
deploys" into "push, then rerun".

## What was seen

Both runs failed the same assertion, at the same line:

| Run | Commit | Attempt | Failure |
| --- | --- | --- | --- |
| 40771681892 (`master`) | `a0954e69` | 1 | `it stays up after blur` — `'1' !== '0'`, `column-reorder.test.ts:485:14` |
| 40787347044 (PR #128, LAI-583) | `8fad4ac2` | 1 (job 123163735068) | the same assertion, the same line |

Each time the subtest failing made its parent, *"the head reveals its own
chrome"* (`:418`), report `1 subtest failed`. Nothing else in the file failed.

The assertion reads `.lane-head .lane-menu`'s opacity after `el.blur()` with
`settledOpacity()` (`:392`). That helper returns as soon as **two reads 25 ms
apart agree**. `board.css` fades the menu with `transition: opacity 0.12s
ease` (`:1481`).

**A guess, not checked:** if the first two reads after `blur()` both land
before the fade has visibly started (for example on a loaded runner), they
agree on `'1'` and the helper reports that as settled. The fix may sit in the
helper, which the file's other opacity assertions also use, rather than in
this one test. Find the cause before changing anything.

## Acceptance criteria

- [x] The cause is named with evidence: a run that reproduces the failure on
      purpose (CPU throttling, a slowed transition, or a loop of the subtest
      under load), with the command and its output in this file.
- [x] The test or the helper waits for the thing the assertion is about, the
      fade finishing, and not for "two reads agree". No longer fixed sleep is
      added.
- [x] The fix is shown to matter: undo it and the reproduction from the first
      criterion goes red again; put it back and it goes green. Both runs are
      recorded here.
- [x] Every other `settledOpacity()` caller in the file still passes, and any
      of them that had the same weakness is fixed in the same change (sweep
      the file, §5).
- [x] The repo-root gate exits `0` for `pnpm test`, `pnpm lint` and
      `pnpm format`, each captured on its own line.

## Notes

- Filed by Belka from the two CI runs above, without fixing anything.
- Phase 2.5 card, under LAIKA-785, Sprint 10. Tags `phase-2-5`, `host-belka`.
- Related, not duplicates: LAI-715 (other browser-test flakes on GitHub
  runners) and LAI-739, which fixed an earlier `column-reorder` flake under
  load, caused by a status re-read reverting a column edit.

## Evidence (Strelka, 2026-10-29)

### Cause

`settledOpacity()` returned the first value two reads 25 ms apart agreed on.
A fade that has **not visibly started yet** agrees with itself, so the
helper returned the *start* value as the settled one: `1` straight after
`blur()`, which is exactly `'1' !== '0'` at `it stays up after blur`. The
guess in *What was seen* was right, and it is not specific to blur — every
caller that expects the opacity to **change** has it (the sweep below).

**What did not reproduce it:** CPU throttling via CDP
(`Emulation.setCPUThrottlingRate`) at 20× and at 100×, looping focus/blur
20 times each — 0 wrong of 20 both times (the 100× run took 43 s). Throttling
slows each read as much as the fade, so the reads still straddle a change.
What reproduces it is the fade **not starting** for longer than two reads,
which is what a runner that paints no frame between them looks like; that
link to the CI runners is inferred, not measured on one.

### Reproduction (test-only, not committed)

Appended to `server/web/test/browser/column-reorder.test.ts`, which already
has `open`, `stub` and `settledOpacity` in scope. It injects a
`transition-delay` from the test (board.css is untouched): the fade holds its
start value for `DELAY` ms before it moves.

```ts
void describe('REPRO LAI-595', () => {
  const stall = (h: Harness) =>
    h.page.addStyleTag({
      content: `.lane-head .lane-menu { transition-delay: ${process.env.DELAY ?? '100'}ms; }`,
    });

  void test('repro: blur', async () => {
    const h = await open('/board?project=laika-core', stub());
    try {
      await h.page.locator('.lane-head .lane-menu').first().focus();
      assert.equal(await settledOpacity(h, '.lane-head .lane-menu'), '1', 'focus does not reveal it');
      await stall(h);
      await h.page.locator('.lane-head .lane-menu').first().evaluate((el: HTMLElement) => { el.blur(); });
      assert.equal(await settledOpacity(h, '.lane-head .lane-menu'), '0', 'it stays up after blur');
    } finally { await h.close(); }
  });

  void test('repro: focus', async () => {          // :485's shape
    const h = await open('/board?project=laika-core', stub());
    try {
      await stall(h);
      await h.page.locator('.lane-head .lane-menu').first().focus();
      assert.equal(await settledOpacity(h, '.lane-head .lane-menu'), '1', 'focus does not reveal it');
    } finally { await h.close(); }
  });

  void test('repro: hover', async () => {          // :447's shape
    const h = await open('/board?project=laika-core', stub());
    try {
      assert.equal(await settledOpacity(h, '.lane-head .lane-menu'), '0', 'visible at rest');
      await stall(h);
      await h.page.locator('.lane-head').first().hover();
      assert.equal(await settledOpacity(h, '.lane-head .lane-menu'), '1', 'the head did not reveal it');
    } finally { await h.close(); }
  });
});
```

Command, from `server/web/`:

```
DELAY=100 node --test --test-name-pattern="^repro: " test/browser/column-reorder.test.ts
```

### Red with the fix undone, green with it restored

Undo = the old helper body swapped back in, everything else (including the
repro) identical. Each swap was checked before the run: `grep -c 'now ===
previous'` → `1` and `grep -c '.getAnimations()'` → `0` for the undo; `0`
and `1` for the restore.

Undone — `EXIT 1`:

```
    not ok 1 - repro: blur
      error: |-
        it stays up after blur
        '1' !== '0'
      expected: '0'
      actual: '1'
    not ok 2 - repro: focus
      expected: '1'
      actual: '0'
    not ok 3 - repro: hover
      expected: '1'
      actual: '0'
# pass 0
# fail 3
```

Restored — `EXIT 0`:

```
    ok 1 - repro: blur
    ok 2 - repro: focus
    ok 3 - repro: hover
# pass 3
# fail 0
```

The blur failure is the CI one: same message, same `'1' !== '0'`.

### The fix

`settledOpacity()` now runs one `page.evaluate` that takes the element's
opacity `CSSTransition`s from `getAnimations()` (which flushes style, so a
transition the last hover/focus/blur started is listed even while it is still
in its delay), awaits their `finished` with `allSettled`, re-checks, and reads
`getComputedStyle(el).opacity` only when none is left. No fixed sleep: the
25 ms poll is gone. It gives up after 20 passes with
`still fading at <value>`, which no assertion in the file accepts.

### Sweep — every `settledOpacity()` caller in the file

`grep -n "settledOpacity(" server/web/test/browser/column-reorder.test.ts`
(no `head`): the definition plus six calls, all through the one helper, so
the fix reaches all of them.

| Line (after the fix) | Assertion | Expects a change? | Had the weakness? |
| --- | --- | --- | --- |
| `:443` | `visible at rest` → `0` | no | no — nothing fading, both versions read `0` |
| `:447` | `the head did not reveal it` → `1` | yes, hover | **yes** — `repro: hover` red undone |
| `:452` | `a sibling lane lit up` → `0` (index 1) | no | no |
| `:468` | `the body still reveals them` → `0` (index 1) | no | no |
| `:485` | `focus does not reveal it` → `1` | yes, focus | **yes** — `repro: focus` red undone |
| `:495` | `it stays up after blur` → `0` | yes, blur | **yes** — the CI failure |

No other file defines or calls `settledOpacity` (`grep -rn settledOpacity
server/src server/web/src server/web/test server/test`: only this file).

The whole file, fix in, repro removed — three runs of
`node --test test/browser/column-reorder.test.ts` from `server/web/`: each
`EXIT 0`, `# tests 10`, `# pass 10`, `# fail 0`.

### Gate

Recorded in the PR body and `logs/strelka-2026-10-29.md`: the repo-root gate
was run three times after the last edit, under `/tmp/strelka-gate.lock`, each
`pnpm test`, `pnpm lint` and `pnpm format` captured on its own line.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #139.
