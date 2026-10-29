---
id: LAI-320
title: 'The client declares RegisteredAgent.owner_display_name (the client half of LAI-592)'
area: shell
assignee: belka
priority: p1
depends-on: [LAI-592]
discovered-from: LAI-592
started: 2026-10-29T18:59:55Z
status: review
finished: 2026-10-29T19:01:14Z
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

- [x] `RegisteredAgent` declares `owner_display_name: string`
- [x] `view-type-drift.test.ts` is green against LAI-592's server half
- [ ] Gate: repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0

## Merge

§4.4: Belka merges LAI-592's CORE half into local `master` without pushing;
this half merges that `master`, lands green, and both are pushed as one
state.

## Built (Belka, 2026-10-30, stacked on LAI-592 as `LAI-592-web`)

- `server/web/src/api/agents.ts`: `readonly owner_display_name: string;` on
  `RegisteredAgent`, beside `owner_user_id`.
- `server/web/test/api/{agent-devices,agents,selected-agent}.test.ts`,
  `server/web/test/routes/screens/developer/agent-readiness.test.ts`: their
  `RegisteredAgent` fixtures carry the field (web `tsc` refused them without).
- Verified: `node --test test/api/view-type-drift.test.ts` 4 pass, 0 fail;
  the four fixture files pass; web `tsc --noEmit` exit 0 (it includes the
  browser tests). Mutation: the field removed, `view-type-drift` is red on
  exactly the quoted assertion (exit 1); restored, SHA checked.
- Gate criterion left unticked here: the local run was limited to touched
  tests (no browser tests on Belka); PR CI runs the full root gate.
- No owner shown in the Devices view: optional, not done.
