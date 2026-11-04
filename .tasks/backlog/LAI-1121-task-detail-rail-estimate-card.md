---
id: LAI-1121
title: 'Task detail rail: an Estimate card holding Effort and Tokens, and the Details rows in the design''s order'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-1117]
discovered-from: LAI-1117
status: backlog
---

## Goal

LAI-1117 shipped the redesign's main column and the rail's status sub-line,
but left two rail changes from the 2026-11-04 design undone: the **Estimate**
card (Effort with its override and *Why <level>?*, similar tasks with their
durations, actual, tokens *<total> of <p80> (<pct>)* with the cost line and
the budget bar) and the **Details** rows in the design's order (assignee,
agent, priority, labels, sprint, then parent, due, planned start, reporter,
created via, outside id, watchers, discovered from).

## Acceptance criteria

- [ ] `ForecastSection` and `TokensSection` render in the rail as one Estimate
      card, with a compact layout at 352px; every control they have today
      stays (override, budget editor, runaway banner, Details fold).
- [ ] The token headline uses `tokensOfLine` (`rail-derive.ts`).
- [ ] The Details rows follow the design's order; `task-panel.test.ts`'s
      label pin is updated to it, by name.
- [ ] `task-size.test.ts` and `task-tokens.test.ts` pass with the sections in
      the rail; no sideways scroll at 390px.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Left out of LAI-1117 to keep that PR reviewable; the sections still render
in the main column exactly as before.
