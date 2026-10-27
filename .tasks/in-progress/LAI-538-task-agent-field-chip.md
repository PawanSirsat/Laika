---
id: LAI-538
title: 'Task drawer Agent field, agent chip on cards, list column + filter, owner + agent in activity, client mirror of agent_selected'
area: web
assignee: shell
priority: p1
depends-on: [LAI-535, LAI-536]
discovered-from:
status: in-progress
started: 2026-10-27T21:51:41Z
---

Implements **proposal §6 (Cards, task drawer), §3** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human picks an agent for a task from the drawer and sees, on the
card, in the list and in activity, which agent the work is meant for and which
agent wrote each change — distinct from who created the card.

## Scope

- Drawer: an **Agent** row under Assignee, a `Dropdown` combobox of eligible agents with owner, device and availability, and the reason an agent cannot be picked.
- Cards: compact agent chip as a new `CardFields` entry, on by default; the human avatar stays.
- List view: agent column and an agent filter.
- Activity and comments show owner + agent; legacy rows show "agent (unregistered token)".
- Client mirror of `ACTIVITY_TYPES` gains `agent_selected` with its wording.

## Out of scope

- Execution states (LAI-543).
- Hand-off (LAI-549).

## Acceptance criteria

- [ ] Choosing an agent sends `selected_agent_id` and shows it after reload from the API (e2e).
- [ ] An ineligible agent is listed disabled with its reason, and cannot be selected by keyboard either.
- [ ] The `created_via==='mcp'` badge and "Created via: Agent" keep their meaning (existing tests unchanged).
- [ ] `agent_selected` is mirrored and worded; the client/server drift check is green against LAI-535.
- [ ] Both themes, keyboard, 390 px.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest for the combobox and chip; client mirror drift test; Playwright e2e select → reload → activity line; screenshots light/dark/narrow.

## Dependencies

`depends-on: [LAI-535, LAI-536]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

`agent_selected` is three-owner (CLAUDE.md §4.4): **LAI-533** (SPEC §4.8), **LAI-535** (enum), **LAI-538** (client mirror + wording, this task).

Proposed to absorb the "Alice via Codex" attribution half of **LAIKA-491** (proposal §8.1); its "needs a human" state stays a card of its own.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-538-task-agent-field`

## Migration / rollout notes

Second half of the `agent_selected` three-owner merge (§4.4 step 4): merge CHIEF's local `master` carrying LAI-535, complete against a green gate.

## Notes

- **Claimed by SHELL (polly dispatch, Belka), 2026-10-28.** Worktree
  `Laika-agent-field`, branch `LAI-538-drawer-agent-field`, base `2b229e1e`:
  LAI-535 head `38ab6851` (draft PR #105, on #102, on #98/#96) with LAI-537
  (#104) and LAI-536 (#101) merged in. Must not merge before them.
- **Deviation, recorded as §2 asks:** the `depends-on` tasks are in
  `.tasks/review/`, not `done/`. CHIEF dispatched this against them, stacked.
- **D-114** approved in substance; authorised-account record pending, so the PR
  stays a draft.
