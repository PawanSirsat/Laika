---
id: LAI-1106
title: 'Pair the four capacity response types in view-type-drift, and take them out of UNPAIRED'
area: shell
assignee: unclaimed
priority: p3
depends-on: [LAI-1038, LAI-1102]
discovered-from: LAI-1102
status: backlog
---

## Goal

LAI-1102 gave `AgentCapacityView`, `CapacityPingView`, `LauncherView` and
`PingAgentResult` their client types (`server/web/src/api/capacity.ts`:
`AgentCapacity`, `CapacityPing`, `Launcher`, `PingResult`). The server's
response census still lists all four in `UNPAIRED` as *no client type
exists* (LAI-1038), which is now untrue.

They could not be paired in LAI-1102 without reddening the gate: the census
reads `server: '…'` literals in `view-type-drift.test.ts`'s `PAIRS`, so a
`PAIRS` entry turns `response-type-coverage.test.ts` › *names nothing that is
already paired or no longer served* red (`… is paired now — remove it from
UNPAIRED`) until `UNPAIRED` loses the entry in the same landing. Each half is
red alone — the CLAUDE.md §4.4 shape.

Until this lands, `server/web/test/api/capacity.test.ts` compares the six
shapes' top-level fields both ways, which is real coverage but outside the
census.

## Scope

- **SHELL:** four `PAIRS` entries in
  `server/web/test/api/view-type-drift.test.ts` (`services/agent-capacity.ts`
  ↔ `capacity.ts`), and drop the field-pair loop from `capacity.test.ts` if
  the drift check now covers it (keep its word lists and clocks).
- **CORE (named crossing, for CHIEF to grant or split):** remove exactly the
  four `UNPAIRED` entries named above from
  `server/test/tooling/response-type-coverage.test.ts`. `LauncherReportView`
  stays: only the CLI reads it.

## Acceptance criteria

- [ ] The four types are in `PAIRS`; none of them is in `UNPAIRED`;
      `LauncherReportView` still is.
- [ ] `view-type-drift.test.ts` and `response-type-coverage.test.ts` both
      exit 0, and no other test changes colour.
- [ ] Repo-root gate exits 0.
