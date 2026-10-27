---
id: LAI-543
title: 'Working / Connection lost / Waiting for agent states on cards + drawer execution panel; delete demo/agent-runtime.ts fakes'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-541, LAI-538]
discovered-from:
status: backlog
---

Implements **proposal §6 (Cards, task drawer), §2 (FAKE row)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

The board shows from real data whether an agent is working, has lost
its connection, or is still waited for, and the demo hand-off fakes are gone.

## Scope

- Card states: Working, Waiting for agent, Connection lost (from `last_heartbeat_at` vs the suspect threshold).
- Drawer execution panel: intended agent, active session, last seen, claim generation under Details.
- Delete `web/src/demo/agent-runtime.ts` and every import of it (D-032).
- Client mirror of `claim_expired` with its wording.
- Client mirror of `claim_reclaimed` with its wording.

## Out of scope

- Checkpoint and hand-off UI (LAI-549).

## Acceptance criteria

- [ ] Each state is driven by an API field, asserted with a server fixture, never by a demo module.
- [ ] `demo/agent-runtime.ts` is deleted and the no-demo-string bundle test still passes.
- [ ] States are spelled in text, not colour alone; both themes; 390 px.
- [ ] `claim_expired` is mirrored; drift check green against LAI-541.
- [ ] Repo-root gate exits 0.
- [ ] `claim_reclaimed` is mirrored and worded; drift check green against LAI-541.

## Tests and UI evidence required

Vitest per state; Playwright e2e with an injected-clock server showing Connection lost then expiry; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-541, LAI-538]`.

`claim_expired` is three-owner (CLAUDE.md §4.4): **LAI-540**, **LAI-541**, **LAI-543** (client mirror, this task). `claim_reclaimed` likewise: **LAI-540** · **LAI-541** · **LAI-543** (client mirror, this task).

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1.5–2 days, confidence M.

## Branch

`LAI-543-execution-states`

## Migration / rollout notes

Removes demo-only UI from demo builds.
