---
id: LAI-530
title: 'cli: the look-back deadline test sends a second report when the machine is loaded'
area: cli
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-526
status: backlog
---

## Goal

During LAI-526's gate (2026-10-26, full repo-root `pnpm test` with the browser
suites running beside it), `cli/test/activity-lookback.test.ts`'s *"a
look-back still under way when the deadline nears stops itself; the snapshot
stands"* failed at `w.puts().length` — one snapshot put expected, two
sent (line 843, *"the snapshot was not sent"*). It passed alone
twice and the full rerun exited 0. Its timing is wall-clock (a 20 s deadline,
the year log answered past 15 s), so a slow machine can start a second report
inside the window it measures.

## Acceptance criteria

- [ ] The test no longer depends on how fast the machine is: the clock it
      measures the deadline by is the test's, not the wall's — or the cause is
      found and named here if it is the code rather than the test.
- [ ] It passes under load: ten runs beside a full `pnpm test`, all green.
