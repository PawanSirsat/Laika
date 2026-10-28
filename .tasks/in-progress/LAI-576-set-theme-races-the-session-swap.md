---
id: LAI-576
title: 'web: setTheme clicks a theme control the session swap has just replaced, and the 390px dark pulse test times out'
area: web
assignee: chief
priority: p0
depends-on: []
started: 2026-10-28T17:26:40Z
discovered-from: LAI-532
status: in-progress
---

## Goal

CI / Deploy run 40702908482 on `master` (fe49255c, PR #111) went red at the
gate's Test step, so nothing deployed. One test:
`server/web/test/browser/organisation-pulse.test.ts:114`, *"fits > 390px, dark:
the tiles sit in the page"*. `setTheme` (`test/browser/harness.ts`) resolved
`.theme-switch, .user-menu-trigger` to the pre-session header's
`.theme-switch`, decided to `click()` it, and the element was detached when
the signed-in shell replaced the header; the retried click re-resolved to
`.user-menu-trigger`, which is in the off-canvas sidebar at 390px and so
"outside of the viewport" for 30s.

Decide with evidence whether the user menu is unreachable on a phone (a
product regression) or the harness races the session swap, and fix the one
that is wrong.

## Acceptance criteria

- [ ] The cause is shown, not assumed: the user-menu trigger's box at 390px in
      both themes, with the navigation closed and opened.
- [ ] If the harness races: `setTheme` picks and acts on its control in one
      step, so a swap between choosing and clicking cannot send the click to
      the other control; what the `fits` tests assert is unchanged.
- [ ] Shown to matter: the old `setTheme` fails under a forced swap and the
      new one passes; `organisation-pulse.test.ts` passes at least 5 runs.
- [ ] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0.
