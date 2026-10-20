---
id: LAI-824
title: 'A usage day over 200 rows is refused whole, and the collector then sends nothing for days at a time'
area: cli
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-815
status: backlog
---

## Goal

A day with more usage rows than the board takes never stops the collector
sending the days around it.

## Found (LAI-815, 2026-10-20)

- The board refuses a usage report whose day carries more than 200 rows
  (`TOKEN_USAGE_ROWS_PER_DAY_MAX`, `.max(...)` on `rows` in
  `server/src/http/routes/local-activity.ts`): `422`, the whole report.
- The collector has no such cap. `daysOf` in `cli/src/activity-usage.ts`
  emits one row per agent × model × task (× automated since D-091), however
  many there are, and `usageReports` never splits a day (by design: a day is
  replaced whole).
- On a `422` the collector waits a day (`refused`, `next_at = now + DAY_S`,
  around `cli/src/activity-usage.ts:2919`) and then sends the same oldest-first
  days again, so one oversized day refuses every report that carries it, every
  day, until it falls out of the 31-day window.
- Not reached today: the LAI-815 replay of this Mac's logs measured at most
  **10** rows a day. D-091's `automated` flag can at most double a day's rows,
  so the risk grew, but it was there before.

## Acceptance criteria

- [ ] A day with more than 200 rows still reaches the board, folded so that no
      token is lost or counted twice (for example, its smallest rows folded
      into unattributed per agent × model × automated), and a test builds such
      a day and shows the report is accepted by the contract mirror in
      `cli/test/support/local-activity-contract.ts`.
- [ ] The other days in the same report are sent as before.
