---
id: LAI-531
title: 'web: the 390px confirmation test measures the card mid-animation and fails on a slow machine'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-526
status: in-progress
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

- [ ] A test that measures the confirmation waits for its entry animation to
      finish first, so no measurement depends on how fast the machine is.
- [ ] Shown to matter: with animations slowed tenfold the old test fails and
      the new one passes.
- [ ] The gate is green and the release of LAI-526 and LAI-527 goes out.
