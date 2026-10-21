---
id: LAI-846
title: "Wait for the intended sidebar state in My day's browser layout tests"
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-841
status: backlog
---

## Goal

The My day layout tests measure the expanded or folded sidebar state they
name, after the automatic rail band and width transition have finished.
A stale pre-resize toggle must not silently select the wrong geometry.

## Acceptance criteria

- [ ] Reproduce and remove the resize-then-read race in the sidebar setup
      loops at `server/web/test/browser/my-day-v2.test.ts:907-923`,
      `:955-969` and `:1025-1039` (base `d36d2ee5`). Wait on the intended
      expanded state and final width before measuring, with no sleep.
- [ ] Keep both expanded/folded states and the width/theme coverage. Assert
      each intended state explicitly, so a missing toggle or skipped setup
      cannot make geometry assertions pass in the wrong state.
- [ ] Verify repeatedly and under CPU load. The root gate's `pnpm test`,
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
