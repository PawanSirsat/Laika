---
id: LAI-578
title: 'web: setTheme retries only when the session replaced its control, and propagates every other failure'
area: web
assignee: shell
priority: p1
depends-on: []
started: 2026-10-28T18:29:15Z
finished: 2026-10-28T18:34:02Z
discovered-from: LAI-576
status: done
accepted: 2026-10-29T13:57:10Z
---

## Goal

Cross-vendor review of #116 (LAI-576, merged as 4bb4846c) failed with one
blocking finding. In `server/web/test/browser/harness.ts`, `setTheme` wraps
every action and wait in its retry loop in `.catch(() => undefined)`. So a
click that fails for a reason other than detachment, on a control that stays
mounted, is retried silently and the helper passes. That is a blanket retry.
LAI-576 needed recovery from one thing only: the signed-in shell replacing
the control between choosing it and acting on it.

## Acceptance criteria

- [x] `setTheme` retries only when the control it chose was detached
      (replaced); every other error propagates with its original message.
- [x] A test for the review's reproduction fails on the 4bb4846c helper and
      passes after the fix. The reproduction: the header switch's click rejects
      for a non-detachment reason while the switch stays mounted, and a later
      click would succeed.
- [x] The two forced-race cases from LAI-576 stay green.
- [x] Breaking the fix on purpose turns the new test red.
- [x] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0.

## Build notes (SHELL, 2026-10-28)

- `test/browser/harness.ts`: `setTheme` holds the chosen control as an
  `ElementHandle`. `replacedDuring(control, act)` retries only if `act`
  failed **and** `control.isConnected` is now `false`. Any other failure,
  including one where `isConnected` cannot be read, is rethrown unchanged.
  A successful action leaves the loop, and the final 5s `data-theme` wait
  decides. There are no `.catch(() => undefined)` calls left in the helper.
  `THEME_CLICK_MS` (10s) is exported, and the test uses it to time the
  release.
- `test/browser/harness-theme.test.ts`: new case *a click refused while the
  switch stays mounted fails, with its own message*. `/me` is held for the
  whole test, and a full-page sheet refuses the pointed click (*intercepts
  pointer events*). The sheet is lifted `THEME_CLICK_MS + 1s` in, so a
  retry would succeed. The test asserts that `setTheme` rejects with that
  message, the theme has not changed, and the switch is still mounted
  without a session.
- **Red on the 4bb4846c helper**: *Missing expected rejection*. The other 4
  cases are green there.
- **Mutations**, run with an anchor check and the file restored by `cmp`:
  - `replacedDuring` always returns `true` (blanket retry): the new case
    goes red and the race cases stay green.
  - It always rethrows (no recovery): both forced-race cases go red with
    *not attached to the DOM*, and the new case stays green. So the race
    cases really do go through the replacement path.
- After the fix: `harness-theme.test.ts` 5/5 on 5 of 5 runs;
  `organisation-pulse.test.ts` 7/7 on 5 of 5 runs.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #117.
