---
id: LAI-576
title: 'web: setTheme clicks a theme control the session swap has just replaced, and the 390px dark pulse test times out'
area: web
assignee: chief
priority: p0
depends-on: []
started: 2026-10-28T17:26:40Z
finished: 2026-10-28T17:32:04Z
discovered-from: LAI-532
status: review
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

- [x] The cause is shown, not assumed: the user-menu trigger's box at 390px in
      both themes, with the navigation closed and opened.
- [x] If the harness races: `setTheme` gives each control its own locator and
      re-chooses until the theme turns, so a swap between choosing and
      clicking cannot send the click to the other control; what the `fits`
      tests assert is unchanged.
- [x] Shown to matter: the old `setTheme` fails under a forced swap and the
      new one passes; `organisation-pulse.test.ts` passes at least 5 runs.
- [x] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0.

## Build notes (CHIEF, 2026-10-28)

**Cause: the harness, not the product.** Measured on fe49255c at 390px with
the stub `organisation-pulse.test.ts` uses:

| | light | dark |
| --- | --- | --- |
| `.shell-head` | x 0, width 390 | x 0, width 390 |
| `.user-menu-trigger`, nav closed | x −204, width 195 | x −204, width 195 |
| `.user-menu-trigger`, nav open | x 8, width 195 | x 8, width 195 |

Off-canvas while closed is the LAI-019 layout; the header is not widened, and
a pointed click reaches the menu once the navigation opens. With `/me` held
the page shows one `.theme-switch` and no user menu; answered, the reverse.
So the CI call log is the session swap landing between `setTheme` choosing
the header switch and clicking it.

- `test/browser/harness.ts` `setTheme`: one locator per control, the choice
  re-made each pass until the theme turns (20s), each attempt bounded at 2s.
  The header switch is still a pointed click; the menu is still dispatched.
  The final `waitForFunction` is unchanged.
- `test/browser/harness-theme.test.ts` (new): the phone's user menu is
  off-canvas until the navigation opens, then reachable (both themes); and
  `setTheme` with `/me` held and the switch kept unstable, released 300ms in.
  **Old helper: both forced cases red** with CI's call log (*detached*, then
  *outside of the viewport*); new helper: green, 5 runs of 5.
- `organisation-pulse.test.ts`: unchanged, 7/7 on 5 runs of 5 at master and
  on the branch (the race does not reproduce unforced on this laptop).
