---
id: LAI-587
title: 'Agent line shows harness · device on cards and harness · device · vendor · model in drawer/activity, with Details'
area: web
assignee: shell
priority: p1
depends-on: [LAI-586]
discovered-from: LAI-532
started: 2026-10-28T22:19:05Z
status: review
finished: 2026-10-28T22:33:56Z
---

The SHELL half of **D-118** (proposed), `docs/proposals/LAI-532-agent-identity-model.md`
(PR #121). The server half — session `harness`, `harness_version`, `model` on
sessions, claims and activity rows — is LAI-586.

## Goal

A person sees which agent is doing the work in one short line, and what
exactly ran one click away. From D-118: *"The UI shows one short line —
`Polly · Belka` on cards; `Polly · Belka · Codex · gpt-5.5` in the drawer and
in activity; full session details (versions, session id, claim generation)
behind an expandable Details. Colour is never the only signal."*

## Acceptance criteria

- [x] Cards show the agent as `<harness> · <device>` (e.g. `Polly · Belka`)
- [x] The drawer and activity rows show `<harness> · <device> · <session harness> · <model>` (e.g. `Polly · Belka · Codex · gpt-5.5`), using the session fields LAI-586 adds; a row with no session snapshot (older history) shows the agent line alone, inventing nothing
- [x] An expandable **Details** shows the session's versions, session id and claim generation, labelled self-reported
- [x] Colour is never the only signal
- [x] Both themes, 1440 and 390 px
- [x] Client types/mirrors take LAI-586's new fields, and any web drift guard LAI-586 left red is green

## Notes / context

- Server fields (LAI-586): `agent_sessions.harness`, `harness_version`, `model`, `client_version`; activity rows carry `agent_session` `{ id, harness, harness_version, model }` or null.

## Claim note (deviation, recorded per §2 step 1)

Claimed with `depends-on: [LAI-586]` not yet in `.tasks/done/`: LAI-586 is in
cross-review as PR #123 (head `963a2d68`). Built **stacked** on
`LAI-586-selected-agent-owns-claim` per §4.4 on the manager's direction
(belka dispatch, 2026-10-29); the PR targets that branch, not `master`.

## Outcome

- **Cards**: unchanged code — the existing neutral `AgentChip`, `<harness> ·
  <device>` (`Claude Code · Belka`), no session words; pinned by
  `test/browser/agent-line.test.ts`. An agent registered with harness
  `omnigent` reads **`Omnigent · Belka`**, not `Polly · Belka`: the chip names
  the harness, not the registered name. Showing the registered name is the
  chip/label question LAI-583 is reshaping, so it is left there.
- **Drawer + activity**: `agentLine()` (`src/api/agent-session.ts`) appends
  the row's `agent_session` harness (product name when known, the slug as sent
  otherwise) and model; missing parts are omitted, a row with no snapshot is
  the agent alone. History, the Activity screen and agent comments read it via
  `viaLine()`; the execution panel draws **Ran as** from the claim row (an
  expiry inherits the take's snapshot of the same generation).
- **Details**: a button with `aria-expanded`/`aria-controls` (the drawer's
  fold pattern) replaces the native `<details>`; it holds claim generation,
  session id, claimed-at, harness version, model and the self-reported line.
  *Last seen* is not drawn: no task read serves the live session yet
  (LAI-568/LAI-593).
- **D-119**: `selectedForAnotherAgentWords()`; the Agent row's refusal says
  *"Selected for Claude Code · Belka — only that agent can start it."* A
  person is never fenced by D-119, so no UI path is known to receive it today;
  the words are there for when one does.
- **Drift**: `ActivityEvent.agent_session` turns `view-type-drift.test.ts`
  green.
