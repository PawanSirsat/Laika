---
id: LAI-564
title: 'Pair the agent response types: PAIRS for RegisteredAgent, AgentGrant, CreatedAgentToken, and drop their three UNPAIRED entries'
area: web
assignee: strelka
priority: p2
depends-on: [LAI-534, LAI-537]
discovered-from: LAI-537
status: in-progress
started: 2026-10-28T14:07:13Z
---

Filed by SHELL (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-537 added the client mirrors in `server/web/src/api/agents.ts` —
`RegisteredAgent` (server `AgentView`), `AgentGrant` (`AgentGrantView`) and
`CreatedAgentToken` (`CreatedAgentToken`), all from
`server/src/services/agents.ts`. They are **not** in
`server/web/test/api/view-type-drift.test.ts`'s `PAIRS` yet, so nothing
asserts the two sides agree field by field.

Pairing them makes three entries in `server/test/tooling/response-type-coverage.test.ts`'s
`UNPAIRED` stale — `AgentView`, `AgentGrantView`, `CreatedAgentToken`, each
`'no client type exists'` — and that file's staleness check goes red
(`names nothing that is already paired or no longer served`). That list is
CORE's, so this is a two-owner change (CLAUDE.md §4.4) and LAI-537 did not
reach across.

## Scope

- **SHELL:** three `PAIRS` entries in `view-type-drift.test.ts`
  (`serverFile: 'services/agents.ts'`, `clientFile: 'agents.ts'`).
- **CORE:** remove the three `UNPAIRED` entries named above.
- Merge per §4.4 so `origin/master` never sees the red.

## Acceptance criteria

- [ ] The three pairs are asserted by the drift check, and green.
- [ ] `UNPAIRED` no longer names `AgentView`, `AgentGrantView`, `CreatedAgentToken`.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
