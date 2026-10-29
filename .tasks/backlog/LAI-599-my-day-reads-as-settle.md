---
id: LAI-599
title: 'web: my-day "a typed length says what it understood" read 1 h 45 min for 1h 30m on CI'
area: shell
assignee: unclaimed
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-830
status: backlog
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

- [ ] The cause is named with evidence: a run that reproduces `1 h 45 min` on
      purpose (CPU throttling, or delaying the update), with the command and
      its output in this file.
- [ ] The fix addresses that cause. If the test is wrong, it waits for the
      settled value without loosening what it asserts. If the screen is
      wrong, the screen is fixed and the test is left as strict as it is.
- [ ] The fix is shown to matter: undo it and the reproduction goes red; put
      it back and it goes green. Both runs are recorded here.
- [ ] Every my-day browser suite still passes, and `pnpm lint` and
      `pnpm format` exit `0`, each captured on its own line.

## Notes

- Filed by Belka (dispatched by polly) from the CI run above.
- Phase 2.5 card, under LAIKA-785. Tags `phase-2-5`, `host-belka`.
