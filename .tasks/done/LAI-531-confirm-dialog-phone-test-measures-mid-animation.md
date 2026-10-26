---
id: LAI-531
title: 'web: the 390px confirmation test measures the card mid-animation and fails on a slow machine'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-526
status: done
finished: 2026-10-26T09:19:07Z
started: 2026-10-26T09:16:37Z
---

## Goal

CI / Deploy run 40296046622 (push 0d8b2c02, LAI-526 and LAI-527) went red at
the gate's Test step, so nothing deployed. One test:
`server/web/test/browser/confirm-dialog.test.ts:129`, *"390 px: Delete entry
from the sheet — the two buttons full width …"*, failed `'not full width'`.
It passed on the two runs before it and locally.

The card rises in with `confirm-in` — 160ms, `translateY(0.5rem)
scale(0.98)` — and the test reads the card, the action and Cancel in three
separate `boundingBox()` calls. On a slow runner those land on different
frames of the scale, and a 98% button is about 7px narrower than a 100% one,
so `|ok − cancel| ≤ 1` fails on a layout that is right.

## Acceptance criteria

- [x] A test that measures the confirmation waits for its entry animation to
      finish first, so no measurement depends on how fast the machine is.
- [x] Shown to matter: with a slow runner's gap between the reads the old
      test fails and the new one passes.
- [x] The gate is green and the release of LAI-526 and LAI-527 goes out.

## Build notes and acceptance (CHIEF, 2026-10-26)

- \`test/browser/confirm.ts\`: \`confirmSettled(page)\` waits until every
  animation under \`[data-confirm-layer]\` has finished. Not
  \`document.getAnimations()\`: the 390px test runs a timer whose pulsing dot
  never finishes.
- \`confirm-dialog.test.ts\`: both tests that measure the card call it first.
- **The criterion was wrong about the instrument, and it is corrected above.**
  Animations slowed tenfold (CDP \`Animation.setPlaybackRate 0.1\`) left the
  old test **green**: a slower animation puts three quick reads *closer*
  together in it, not further apart. What CI did was slow the *reader*. A
  120ms pause between the action's read and Cancel's turned the old test red
  with CI's own \`'not full width'\`, and the new one passed with the same
  pause; the pause was then removed.
