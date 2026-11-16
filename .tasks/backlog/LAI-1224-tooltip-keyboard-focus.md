---
id: LAI-1224
title: 'Does a keyboard focus show the shared Tooltip? Not observed in the browser harness'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1223
status: backlog
---

## Goal

`Tooltip.tsx` documents that it shows "on hover and on keyboard focus"
(LAI-1214), with an `ARRIVAL_MS` guard that skips a focus in the first
300 ms after its effect runs. While building LAI-1223, a test that reached
My availability's trigger by keyboard (`focus()`, then `Shift+Tab`, `Tab`,
with `document.activeElement` confirmed on the trigger, then 900 ms) saw
**no visible `role="tooltip"`**, even with the trigger's tooltip put back,
on the pinned clock **and** on the real clock. So either focus does not show
the Tooltip in a real browser, or the harness cannot drive it; the test
could not fail and was dropped.

Two leads, unverified:

- On the pinned clock (`my-day-clock.ts`, `page.clock.setFixedTime`),
  `performance.now()` may stand still, so `now - born < ARRIVAL_MS` is
  always true and a focus never shows a tooltip in any My day test.
- On the real clock it still did not show, so the cause may be elsewhere.

## Acceptance criteria

- [ ] Find out, in a real browser, whether a keyboard Tab onto a control
      with a Tooltip shows it; fix the Tooltip if it does not.
- [ ] A browser test that Tabs onto a control and sees its tooltip, seen
      red once with the focus path broken.
- [ ] If the pinned clock freezes `performance.now()`, say so in
      `my-day-clock.ts` so no test relies on a focus tooltip there.
