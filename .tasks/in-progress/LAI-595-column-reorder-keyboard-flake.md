---
id: LAI-595
title: 'web: column-reorder "the keyboard reaches them with no pointer at all" flakes on GitHub runners'
area: shell
assignee: strelka
priority: p2
parent: LAIKA-785
depends-on: []
discovered-from: LAI-583
status: in-progress
started: 2026-10-29T09:26:58Z
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

- [ ] The cause is named with evidence: a run that reproduces the failure on
      purpose (CPU throttling, a slowed transition, or a loop of the subtest
      under load), with the command and its output in this file.
- [ ] The test or the helper waits for the thing the assertion is about, the
      fade finishing, and not for "two reads agree". No longer fixed sleep is
      added.
- [ ] The fix is shown to matter: undo it and the reproduction from the first
      criterion goes red again; put it back and it goes green. Both runs are
      recorded here.
- [ ] Every other `settledOpacity()` caller in the file still passes, and any
      of them that had the same weakness is fixed in the same change (sweep
      the file, §5).
- [ ] The repo-root gate exits `0` for `pnpm test`, `pnpm lint` and
      `pnpm format`, each captured on its own line.

## Notes

- Filed by Belka from the two CI runs above, without fixing anything.
- Phase 2.5 card, under LAIKA-785, Sprint 10. Tags `phase-2-5`, `host-belka`.
- Related, not duplicates: LAI-715 (other browser-test flakes on GitHub
  runners) and LAI-739, which fixed an earlier `column-reorder` flake under
  load, caused by a status re-read reverting a column edit.
