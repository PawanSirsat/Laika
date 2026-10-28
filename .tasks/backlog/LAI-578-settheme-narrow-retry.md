---
id: LAI-578
title: 'web: setTheme retries only when the session replaced its control, and propagates every other failure'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-576
status: backlog
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

- [ ] `setTheme` retries only when the control it chose was detached
      (replaced); every other error propagates with its original message.
- [ ] A test for the review's reproduction fails on the 4bb4846c helper and
      passes after the fix. The reproduction: the header switch's click rejects
      for a non-detachment reason while the switch stays mounted, and a later
      click would succeed.
- [ ] The two forced-race cases from LAI-576 stay green.
- [ ] Breaking the fix on purpose turns the new test red.
- [ ] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0.
