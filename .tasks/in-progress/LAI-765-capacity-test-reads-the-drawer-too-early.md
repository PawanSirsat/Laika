---
id: LAI-765
title: 'A Capacity browser test reads the task drawer before it renders, and blocks the deploy (server/web/)'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T09:11:26Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-17, through
the orchestrator), single-agent mode, on the temporary branch
`fix-capacity-flake` cut from `master` `c511c602`, worktree
`Laika-capacity-flake`. Board card **LAIKA-570**. Changes
`server/web/test/browser/` only. Not pushed, not merged: the orchestrator
reviews and merges.

GitHub run 39019413534 went red in the `server/web` tests and so deployed
nothing. `server/web/test/browser/capacity.test.ts:642`, in *a chip opens its
task in the task's own space, not the last one opened (LAI-755)*, ran
`assert.match(await drawer.innerText(), /LW-1/)` and got `''`: the test waited
for `.drawer` to **exist**, and the drawer exists before its content renders,
so on the slower GitHub runner the single read came too early. When this is
finished that test, and every browser test added or changed on 2026-10-17 with
the same shape, waits for the thing it is about to measure and then asserts it
exactly as strictly as before.

## Acceptance criteria

- [ ] `capacity.test.ts`'s LAI-755 test waits for the drawer's content (the
      key and the title) before asserting it. The two `assert.match` lines
      still assert `/LW-1/` and `/Toolbar reads its own width/` on the
      drawer's text.
- [ ] The browser tests added or changed today — `capacity.test.ts`,
      `board-sprint-stats.test.ts`, `copy-insecure.test.ts`,
      `activity-heatmap.test.ts`, `review.test.ts`, `connect.test.ts` — are
      swept for the same shape: a single read of `innerText` / `textContent`
      / `count` right after waiting only for an element to exist, or a fixed
      `waitForTimeout` pause before a measurement. Each one found is changed
      to wait for the condition it then asserts (the harness's `until`, or a
      locator `waitFor` on the content), and is listed with file:line and why
      in Notes.
- [ ] No assertion is loosened: every changed test asserts the same values it
      did before. A fixed pause that is a deliberate *nothing happens* window
      (no condition can end it early, per `until`'s doc) stays.
- [ ] No product code changes: `git diff --stat master` names only
      `server/web/test/browser/` files, this task file and the log.
- [ ] `capacity.test.ts` passes 10 runs in a row, and once more with every CPU
      core busy; the commands and results are recorded in Notes.
- [ ] The gate after the last edit: `pnpm test`, `pnpm lint`, `pnpm format`,
      each `EXIT 0`.

## Notes / context

- `until` in `server/web/test/browser/harness.ts` is the house idiom for this
  (2026-10-12): poll a condition, assert nothing, time out quietly so the
  assertion after it reports what was really on screen.
- No new dependencies.
