---
id: LAI-846
title: "Wait for the intended sidebar state in My day's browser layout tests"
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-841
status: review
started: 2026-10-21T16:22:04Z
finished: 2026-10-21T16:59:10Z
---

## Goal

The My day layout tests measure the expanded or folded sidebar state they
name, after the automatic rail band and width transition have finished.
A stale pre-resize toggle must not silently select the wrong geometry.

## Acceptance criteria

- [x] Reproduce and remove the resize-then-read race in the sidebar setup
      loops at `server/web/test/browser/my-day-v2.test.ts:907-923`,
      `:955-969` and `:1025-1039` (base `d36d2ee5`). Wait on the intended
      expanded state and final width before measuring, with no sleep.
- [x] Keep both expanded/folded states and the width/theme coverage. Assert
      each intended state explicitly, so a missing toggle or skipped setup
      cannot make geometry assertions pass in the wrong state.
- [x] Verify repeatedly and under CPU load. The root gate's `pnpm test`,
      `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

Discovered by the sibling-file sweep for LAI-841; no sibling was changed.
Each loop calls `setViewportSize`, reads `aria-expanded` once, and only
waits if it clicks. A pending media change can invalidate the read, and an
attribute change alone does not mean the width transition has finished.
The 1440-to-1024 resize crosses the 1180px automatic-rail breakpoint.

LAI-841 demonstrated the same shape in board-sprint-stats with a controlled
media-listener gate: at 920px its original helper accepted expanded/212px
before the listener ran; delivering the listener collapsed it to 60px.
That reproduced even with reduced motion and a computed transition of 0s.
This establishes the race shape, not a claim that My day's assertions were
observed to fail. Its existing overflow checks can pass with extra space.

The scope is this file's setup and specific state assertions. Do not widen
this into a shared browser-harness or application refactor without evidence.

## Additional observation during LAI-841 verification

A later full root gate (no edits to My day) failed the wider-font case at
`my-day-v2.test.ts:977`, at 1440px and `folded=false`. It reported one cut
`dayline-block-sub`, text `1:00–2:50 PM · 1 h 50 min`. The complete file
immediately passed alone: `pnpm --filter @laika/web exec node --test
 test/browser/my-day-v2.test.ts`, exit 0, 31 collected cases.

This failure is in one of the loops named above, but its cause has not
been isolated. At 1440px it is not evidence of crossing the 1180px media
boundary; investigate its style/resize observation timing rather than
assuming the sidebar race explains it. Root log:
`/tmp/lai841-third-gate.txt`; isolated rerun:
`/tmp/lai841-my-day-rerun.txt`. No sibling was changed on LAI-841.

## Second occurrence (LAI-841 final-tree gate, 2026-10-21 08:22Z)

The same case failed again, identically: `1440 folded=false: cut`, with
`'dayline-block-sub: 1:00–2:50 PM · 1 h 50 min'` at `my-day-v2.test.ts:977`,
in a root `pnpm test` (`VITEST_MAX_WORKERS=2`) whose 1-minute load rose from
20 to 63 while web ran. Then, alone:
`pnpm --filter @laika/web exec node --test test/browser/my-day-v2.test.ts`,
exit 0, 31 collected cases passed.

**A lead, not a finding.** At 1440 nothing has been resized across a band
yet, so this is not the sidebar race this task names. The case adds a
letter-spacing style tag, sets the viewport, and measures
`scrollWidth > clientWidth` at once, with no wait for the layout to choose
its label form. Per the comment at `:947-949`, that form is chosen "by what
fits as drawn". If that choice lands a frame or more after the style tag
under load, the measurement sees the old, wider form. That is unproven. It
wants the same treatment LAI-841 got: hold the step that re-chooses the
form, and show whether the cut appears.

## Builder notes (strelka, 2026-10-21)

**Reproduced first, on base `6b8cd862`, with a scratch test (not committed)**
that held each step under an init-script gate, running today's loop verbatim:

- **Media listener held** (`(max-width: 1180px)` change): 1440 folded, then
  1024 `folded=false`. The old loop clicked on the stale read and accepted
  `{"expanded":"true","px":60}`; released, the shell folded it to
  `{"expanded":"false","px":60}`. Red.
- **`ResizeObserver` held** (FitLabel's re-pick): with the wider-font style,
  1440 `folded=false` measured `["dayline-block-sub: 1:00–2:50 PM · 1 h 50
  min"]`, the exact failure seen twice on LAI-841's root gates. **That one is
  not the sidebar race**: the first 1280→1440 resize changes every box, and
  `FitLabel` re-picks in a React task after the observer, which the old code
  measured ahead of.

**Fix** (`server/web/test/browser/my-day-v2.test.ts`): `layOut(h, width,
folded)` replaces all three loops. It waits until a `NARROW_QUERY` listener
of its own has heard the current width, clicks only then, and asserts
`{expanded, px: 212|60, moving: 0}` (no running animation on `#sidebar`).
`relabelled(h)` then waits two frames plus a posted task. The toggle is no
longer optional (`count() > 0` removed). No sleep and no timeout raised.

**Verification**
- Same gates, fixed setup: under the held media change the setup stays
  pending (`done:false`, still 60px) and lands `{"expanded":"true","px":212}`
  on release. A re-pick delivered late in a frame gives `cut []`.
- Mutations, each confirmed by grep (`MUTANT-n` count 1, then 0 after
  restore):
  1. drop the "heard" condition: red, `went ahead while held`;
  2. make `relabelled` a no-op: red, the `1 h 50 min` cut;
  3. on the real file, skip the click: red,
     `1440 folded=true: the sidebar is not as named`. The file was restored
     and its checksum verified.
- `node --test test/browser/my-day-v2.test.ts` (from `server/web`) 5×: exit 0,
  31 collected cases each, at 1-minute load 5–15.
- Root gate under `/tmp/laika-root-gate.lock`: `TEST 0`, `LINT 0`, `FMT 0`;
  1-minute load 4.85 → 43.31 during `pnpm test`.
