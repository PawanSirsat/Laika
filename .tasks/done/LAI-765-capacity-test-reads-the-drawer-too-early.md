---
id: LAI-765
title: 'A Capacity browser test reads the task drawer before it renders, and blocks the deploy (server/web/)'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T09:11:26Z
status: done
finished: 2026-10-17T09:27:02Z
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

- [x] `capacity.test.ts`'s LAI-755 test waits for the drawer's content (the
      key and the title) before asserting it. The two `assert.match` lines
      still assert `/LW-1/` and `/Toolbar reads its own width/` on the
      drawer's text.
- [x] The browser tests added or changed today — `capacity.test.ts`,
      `board-sprint-stats.test.ts`, `copy-insecure.test.ts`,
      `activity-heatmap.test.ts`, `review.test.ts`, `connect.test.ts` — are
      swept for the same shape: a single read of `innerText` / `textContent`
      / `count` right after waiting only for an element to exist, or a fixed
      `waitForTimeout` pause before a measurement. Each one found is changed
      to wait for the condition it then asserts (the harness's `until`, or a
      locator `waitFor` on the content), and is listed with file:line and why
      in Notes.
- [x] No assertion is loosened: every changed test asserts the same values it
      did before. A fixed pause that is a deliberate *nothing happens* window
      (no condition can end it early, per `until`'s doc) stays.
- [x] No product code changes: `git diff --stat master` names only
      `server/web/test/browser/` files, this task file and the log.
- [x] `capacity.test.ts` passes 10 runs in a row, and once more with every CPU
      core busy; the commands and results are recorded in Notes.
- [ ] The gate after the last edit: `pnpm test`, `pnpm lint`, `pnpm format`,
      each `EXIT 0`. **Runs after this commit**, the last thing before
      hand-back, so its result is in the hand-back and not here: a file cannot
      record a run that happens after it. The earlier run, on `a491e43c`, is in
      Notes, with the one red it showed that is not this change's.

## Notes / context

- `until` in `server/web/test/browser/harness.ts` is the house idiom for this
  (2026-10-12): poll a condition, assert nothing, time out quietly so the
  assertion after it reports what was really on screen.
- No new dependencies.

### Changed — `server/web/test/browser/capacity.test.ts` (lines at `e05ae44d`)

- **:649–659**, *a chip opens its task in the task's own space (LAI-755)* —
  the reported failure. `.drawer` is a frame (`TaskDrawer.tsx:50`) whose
  `#task-drawer-slot` the task panel fills once the task loads. Now `until`
  the drawer's text holds both the key and the title, then the same two
  `assert.match` lines.
- **:560–565**, *an old space-tab link opens the one global page
  (LAI-754)* — `.cap-summary-note` comes from `GET /projects`, a read separate from
  capacity and presence; until it lands the note reads `updated every 20s ·
  live` (`CapacityScreen.tsx`, `scope`). Same race as the drawer, not yet seen
  red. Now `until` the note holds `across 1 space`, then the same
  `assert.match`.
- **:313–319**, *at 390px nothing is clipped (LAI-737)* — a fixed
  `waitForTimeout(300)` before the layout measurement, standing in for the
  content that lands last. Now it waits for `.cap-chip-title` (every chip
  resolves in one `Promise.all`, and only after the spaces' read, so the scope
  note has landed too) and for `document.fonts.ready`. Same three assertions;
  the measurement is now of the finished page, so it can only be stricter.

### Swept and left as they are

Each checked against the component that renders it, not the test alone.

- `capacity.test.ts:224` — 300ms after `setTheme`, which already waits for
  `data-theme`. The card's text renders in the same commit as `.cap-card`
  (`CapacityScreen` draws the loading state until capacity **and** presence
  have landed), so nothing after it can read early.
- `capacity.test.ts:506` (500ms) and `:538` (300ms) — quiet windows for
  *nothing else is asked* and *not retried yet*. What they follow has already
  happened by then: the chips resolve in one batch, so the three reads and the
  first 503 are recorded before the first title is drawn.
- `capacity.test.ts`'s other reads after a `.cap-card`, `.cap` or link wait —
  the same commit as the element waited for: agent markers, client names and
  *working elsewhere* come from presence, which the card waits on; the
  Unlisted link renders only once its count is known, and the sidebar's count
  comes from the same context value; the Agents chip's summary and marks come
  from one presence answer.
- `board-sprint-stats.test.ts` — its pauses (`:293`, `:372`, `:394`, `:421`,
  `:847`) are already labelled quiet windows from the LAI-715 sweep, and its
  measurements go through `reads()` and `settled()`. Today's light-mode test
  reads the keys' colours, which are drawn from the first frame (a dash before
  the counts) and have no colour transition.
- `copy-insecure.test.ts` (new today) — every clipboard read goes through
  `copyWith`'s `until`; the other reads follow a wait on the state they read
  (`data-outcome`), drawn in the same commit.
- `activity-heatmap.test.ts` — today's LAI-761 tests already poll with
  `until` before every assertion.
- `review.test.ts` (new today) — the queue is one read and the detail's
  rounds one more, each drawn in a single commit after the element waited
  for; the sidebar badge renders only with a count above zero.
- `connect.test.ts` — today's changes are safe: *Share local activity* draws
  its spinner in its first render, so the `detached` wait is a real one. The
  6s pauses (`:409`, `:448`, `:529`) are quiet windows for absences. The
  layout pauses (`:1103`, `:1153`, `:1170`, `:1192`, `:1605`, `:1611`,
  `:1645`, `:1665`) are in older tests; the Connect screen has no
  `ResizeObserver`, no `matchMedia` state and no smooth scrolling, and the
  step-change scroll reset runs in the same effect that moves focus, which
  `:1610` waits for. Layout is read synchronously, so none can read early.

### Proof

- **Reproduced**, old shape beside new (`/tmp/lai765/repro.test.ts`, not
  committed): the LAI-755 scenario with every API answer after the chip
  click held 1500ms.
  The old shape — one read right after `.drawer` exists — read
  `"Loading this task"`, no `LW-1`; the new shape passed on the same delay.
  `node --test repro.test.ts`: 2 tests, 2 pass, `EXIT 0`.
- **10 in a row**, final code (`e05ae44d`), from `server/web/`:
  `node --test test/browser/capacity.test.ts`, ten times — every run
  `EXIT 0`, 14 tests, 14 pass, 0 fail.
- **Every core busy**: `yes > /dev/null` once per core (10 of 10), the same
  command once more, then the burners killed by PID — `EXIT 0`, 14 of 14;
  load average 18.55 at the end. No `yes` process left afterwards.
- The same 10 + loaded runs were green on `a491e43c` too, before the lint
  fix changed `/re/.test()` to `includes()` in the two polls.

### Gate on `a491e43c` (before the lint fix)

- `pnpm lint` **EXIT 1**: three `@typescript-eslint/prefer-includes` errors
  on this task's polls. Fixed in `e05ae44d`; `eslint` and `prettier --check`
  on the file both `EXIT 0` after.
- `pnpm format` EXIT 0.
- `pnpm test` **EXIT 1**, **not this change's**:
  `server/test/db/migrate.test.ts` › *0030 closes INSERT OR REPLACE on a
  populated 0029 database (LAI-746)* › *keeps the ratings and refuses a
  replace of one* — `Test timed out in 5000ms` (it took 7743ms) while every
  workspace ran in parallel. Alone, `npx vitest run test/db/migrate.test.ts`
  passes 20 of 20, the whole file's tests in 1.24s. No file under `server/`
  is touched here. Every workspace ran to the end: cli 320/320, server/web
  2001/2001, server 2611 passed and that 1 timed out.
- **Not fixed here** (the brief: browser tests only, no product code, and
  `server/` is another area). A load-sensitive 5s timeout is the same class of
  failure as this task's and could block a deploy the same way; it wants its
  own task.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) after one Claude review (APPROVE: test-only, assertions unchanged, waits bounded); merged on the owner's direct instruction. The migrate/build/parity timeouts under load are filed as LAI-768.
