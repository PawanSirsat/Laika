---
id: LAI-881
title: "Timeline: a stacked block's own count badge never covers its label"
area: web
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-860
status: backlog
---

## Goal

On My day's Timeline, a block's count badge is never drawn over that same
block's label, at any zoom, in either theme, on a phone or a desktop. Since
LAI-314 most blocks carry a badge, so this is now common.

## What is there today (read at `9250fc3e`)

- The badge sits at `top: -0.5rem; right: 0.25rem`
  (`server/web/src/routes/screens/my-day/my-day.css:1030-1044`). Its bottom
  edge is about 10.8px below the block's top.
- A stacked label is one 16px line (`line-height: normal`, `:960-962`). It
  starts about 1px down with three blocks at once, and about 6px down with
  two.
- `placeChips` (`server/web/src/routes/screens/my-day/timeline-derive.ts:373-401`)
  checks every other block (`:396`), every badge already placed (`:397`) and
  both ends of the track (`:395`). It never checks the block's **own**
  label.
- The browser test skips the own block too
  (`server/web/test/browser/my-day-timeline-zoom.test.ts:403`), although its
  title at `:340` promises that no chip is drawn over any label.
- **On screen.** In the top row of three hour-long blocks at 1×, the badge
  covers the last digits of `LAIKA-474`, and covers LAI-866's
  `Needs a card · Acme`.
- The badge has `pointer-events: none` (`my-day.css:1044`). Its tooltip
  cannot be reached, and a click on a badge that hangs over a gap selects the
  gap. The comment at `:1018` says *"A click on it is a click on its
  block"*.

## Acceptance criteria

- [ ] **The browser fixture gains** stretches of 2 and 3 blocks at once, an
      hour each, whose top-row label is 9 characters (the `LAIKA-474` shape)
      or `Needs a card · Acme`. At 1× and 2×, in both themes, at 1440px and
      390px, every badge that is drawn clears its own block's label box,
      using the test's existing `overlaps` (more than 0.5px). Fails today at
      1×; run it red first.
- [ ] **The fix changes no design token** (D-020). It does one of these:
      - keeps the label clear of an end-placed badge on stacked rows;
      - hides the badge where it would cover the label;
      - makes `placeChips` treat the label as an obstacle.
- [ ] **Positive control:** `k1` keeps both its label and its badge at 2×.
- [ ] **Device pixel ratio 2.** Measure at DPR 2 too: the harness opens
      every page at DPR 1 (`newPage()` with no `deviceScaleFactor`,
      `server/web/test/browser/harness.ts:625`). The three-at-once label still
      draws.
- [ ] **`placeChips` unit gaps.** Add a case with a neighbour near one end,
      and a case at exactly 58px. Today these mutations survive: the
      end-placed box moved to the block's start, and the fit test's `<=`
      (`timeline-derive.ts:392`) changed to `<`. Both go red after. Prove each
      mutation landed (a unique anchor and a `grep`), restore the file in a
      trap, and record the runs here.
- [ ] **Claims match the assertions.** The test title and comment at
      `server/web/test/routes/screens/my-day/timeline-derive.test.ts:426` and
      `:429`, and the browser test title at
      `my-day-timeline-zoom.test.ts:340`, claim only what their assertions
      prove (CLAUDE.md §5).
- [ ] **The badge's pointer.** Either a reachable tooltip is restored, or the
      comment at `my-day.css:1018` is made true: a click on a badge is a
      click on its block, never on a gap.
- [ ] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Builds on **Strelka** (D-097; board tag `host-strelka`): the browser tests
  run many times.
- **Files:** `server/web/src/routes/screens/my-day/` (`Timeline.tsx`,
  `timeline-derive.ts`, `my-day.css`),
  `server/web/test/routes/screens/my-day/timeline-derive.test.ts`,
  `server/web/test/browser/my-day-timeline-zoom.test.ts`. The harness
  (`server/web/test/browser/harness.ts`) only to open a page at DPR 2. No new
  dependencies.
- LAI-300 is the design for four or more blocks at once. This task is only
  about two and three, where a label is drawn today.
- Use `Acme` in fixtures, never a real client's name.
