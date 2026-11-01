---
id: LAI-558
title: 'Optional local launcher, disabled by default, + settings/status UI — PARKED pending D-117'
area: cli
assignee: unclaimed
priority: p2
depends-on: [LAI-548]
discovered-from:
status: backlog
---

Implements **proposal §4.7 (`laika agent launcher`), §8 (Launcher)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

**Parked.** If the owner allows it in D-117, a local launcher can
start an accepted task's harness on the receiving device, off by default, with a
settings and status view.

## Scope

- `laika agent launcher` (cli) and its settings/status UI (server/web), both SHELL's.

## Out of scope

- Anything before D-117 is recorded. This conflicts with LAIKA-516 "any agent runner" on the stop list.

## Acceptance criteria

- [ ] D-117 is recorded in `docs/DECISIONS.md` and allows this; otherwise CHIEF closes this task as parked.
- [ ] Disabled by default; enabling needs an explicit setting per device.
- [ ] The launcher never starts a process for an offer that was not accepted.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Node tests; Playwright for the settings view.

## Dependencies

`depends-on: [LAI-548]`.

**Blocked on decision D-117 (proposed, separate from D-114 – D-116).** Parked; stays on the stop list (LAIKA-516) until D-117 is approved as proposal §8 describes. Board tags `blocked-on-decision`, `stop-list`.

## Role / machine

SHELL on Belka. Do not start without the owner's word (stop list). Owner area: `cli` (SHELL).

## Priority

P2 — board priority `p2`.

## Effort

2–4 days, confidence L.

## Branch

`LAI-558-optional-launcher`

## Migration / rollout notes

Off by default.
