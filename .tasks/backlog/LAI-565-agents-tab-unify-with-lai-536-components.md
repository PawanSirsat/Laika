---
id: LAI-565
title: 'Agents tab: use LAI-536''s AgentChip, AgentReadiness and RegistrationSteps once both have landed'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-536, LAI-537]
discovered-from: LAI-537
status: backlog
---

Filed by SHELL (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Why

LAI-537 (Developer access → Agents) was built on LAI-534's branch, where
LAI-536's reviewable agent components (`server/web/src/components/agent/`:
`AgentChip`, `AgentReadiness`, `RegistrationSteps`, PR #101) do not exist. So
LAI-537 drew its own minimal versions inside
`server/web/src/routes/screens/developer/AgentsTab.tsx` — the step rail, the
state pill (`agents-state`) and the harness/device line — rather than copy
LAI-536's files across branches.

## Scope

- Once LAI-536 and LAI-537 are both on `master`, replace those three pieces
  with LAI-536's components, keeping LAI-537's behaviour and tests
  (`test/browser/agents-tab.test.ts`) green.
- Nothing server-side.

## Acceptance criteria

- [ ] The Agents tab renders the agent chip, readiness and step rail through
      `components/agent/`, and its own copies are gone.
- [ ] `agents-tab.test.ts` and LAI-536's tests are green unchanged in intent.
- [ ] Both themes and 390 px still work.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
