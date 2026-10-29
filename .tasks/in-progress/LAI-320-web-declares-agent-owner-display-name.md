---
id: LAI-320
title: 'The client declares RegisteredAgent.owner_display_name (the client half of LAI-592)'
area: shell
assignee: belka
priority: p1
depends-on: [LAI-592]
discovered-from: LAI-592
started: 2026-10-29T18:59:55Z
status: in-progress
---

The client half of LAI-592, under CLAUDE.md §4.4. LAI-592's CORE half adds
`owner_display_name` to the server's `AgentView` (`server/src/services/agents.ts`),
so `GET /api/v1/agents`, `GET /api/v1/agents/:id`, `GET /api/v1/agents/devices`
(on each device's `agents`) and the register and rotate `201`s all carry the
owner's current name. `server/web/` is SHELL's, and `clientOmits` lives there,
so CORE could take no exemption; its branch is red on exactly this assertion
and no other:

```
server/web/test/api/view-type-drift.test.ts
  not ok 2 - no server field is missing from its client type
    AgentView.owner_display_name is served and RegisteredAgent does not declare
    it — add it, or list it in clientOmits with a reason
```

## Scope

- `server/web/src/api/agents.ts`: declare
  `readonly owner_display_name: string;` on `RegisteredAgent`, beside
  `owner_user_id`.
- Nothing else is required to turn the gate green. Showing the owner on the
  Devices view's agent line ("Codex · Cloud — owner Pawan — credential
  expires in 50 min", LAI-592's user-visible outcome) is optional here and may
  be its own task.

## Acceptance criteria

- [ ] `RegisteredAgent` declares `owner_display_name: string`
- [ ] `view-type-drift.test.ts` is green against LAI-592's server half
- [ ] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0

## Merge

§4.4: Belka merges LAI-592's CORE half into local `master` without pushing;
this half merges that `master`, lands green, and both are pushed as one
state.
