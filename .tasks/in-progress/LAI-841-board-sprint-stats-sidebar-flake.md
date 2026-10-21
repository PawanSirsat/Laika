---
id: LAI-841
title: 'Flaky in CI: board-sprint-stats "920px, S2, Dark: search keeps 120px" finds the sidebar closed'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from: LAI-830
status: in-progress
started: 2026-10-21T05:37:45Z
---

## Goal

`server/web/test/browser/board-sprint-stats.test.ts:641` ("the sidebar open,
the row crowded (LAI-727 review)") passes reliably, with no flakes.

On 2026-10-21, GitHub run 39497695287 (the LAI-830 release) failed the gate on
one subtest. The other seven cases of the same suite passed in the same run, a
re-run of the failed job was green, and the root gate on the same commit
passed locally.

```
not ok 6 - 920px, S2, Dark: search keeps 120px
  location: board-sprint-stats.test.ts:645:14
  error: the sidebar is not open — the wrong state
  false !== true   (board-sprint-stats.test.ts:660:20)
```

A failure that comes and goes on one case looks like a race between setting
the sidebar's state (stored preference or click) and reading it, or state
leaking between cases.

## Acceptance criteria

- [ ] Find the cause and name it in this file, with the evidence. Do not
      guess.
- [ ] Fix the test setup, or the app if the app is wrong, so the case waits
      for the sidebar state it asserts on and the cases do not share state.
- [ ] The suite passes 20 times in a row locally, and once under extra CPU
      load.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
