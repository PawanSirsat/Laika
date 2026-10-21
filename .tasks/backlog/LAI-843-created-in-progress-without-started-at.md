---
id: LAI-843
title: 'Tasks created straight into In progress have no started_at'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-822
status: backlog
---

## Goal

Stamp the first start when a task is created already In progress, so actual
start dates and cycle time cover that route as SPEC §4.5 requires.

## Found

The LAI-822 creation sweep found that `createTask` resolves an initial
`in_progress` category, but its insert never sets `startedAt`.
`changeStatus` and `claimTask` already stamp the first start. LAI-822 changes
only completion timestamps; this separate start path stays untouched.

## Acceptance criteria

- [ ] A task created with `status: in_progress` or directly into a custom
      In progress status receives `started_at` at creation. Match SPEC §4.5
      and freeze the estimate at first start as its existing contract requires.
- [ ] Test first: the creation cases fail on the old code; ordinary creates
      keep a null start, and later re-entry keeps the first start.
- [ ] `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes / context

No new dependencies. Sweep every task creation path, including REST and MCP,
without widening the agent permission to create tasks already Done.
