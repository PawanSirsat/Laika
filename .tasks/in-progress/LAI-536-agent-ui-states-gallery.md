---
id: LAI-536
title: 'Reviewable states for agent UI on /design/states — gallery only, no live screens'
area: web
assignee: shell
priority: p1
depends-on: [LAI-533]
discovered-from:
started: 2026-10-27T19:31:31Z
status: in-progress
---

Implements **proposal §6** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Every agent screen state can be reviewed by the owner on
`/design/states` before any live screen is built: agent chip, execution states,
Agent picker, hand-off dialog, Inbox Hand-offs and the Agents tab.

## Scope

- Gallery entries on `/design/states` for: the compact agent chip; Waiting for agent, Waiting for approval, Working, Connection lost, Recovery available, Save needs attention; the Agent picker (eligible, ineligible-with-reason); the hand-off dialog; Inbox → Hand-offs filters; the Agents tab wizard steps.
- Each state rendered in light and dark, and at a narrow width.
- Fixtures live only in the gallery's own state fixtures, never in a shipped screen.
- Agent chips are **neutral**: `--text-2` on `--bg-2` (existing tokens) with the client's agent mark. The owner picks the agent colour after seeing these states (D-020).

## Out of scope

- Wiring any live screen or endpoint (LAI-537, LAI-538, LAI-543, LAI-549, LAI-550).
- Choosing the agent colour (owner question §8.3, D-020): the chip uses neutral text and the agent mark.

## Acceptance criteria

- [ ] Every state named in proposal §6 has a gallery entry (listed in the PR body against §6).
- [ ] Exceptional states are spelled out in text, never by colour alone.
- [ ] No new colour token; no `docs/design/` value changed (D-020).
- [ ] The existing `created_via==='mcp'` badge keeps its meaning and is shown next to the agent chip so the difference is visible.
- [ ] No fixture string from the gallery appears in the built bundle outside `/design/states` (asserted).
- [ ] Repo-root gate exits 0.
- [ ] Chips use only `--text-2` on `--bg-2` and the agent mark; `git diff` shows no change to any theme token or `docs/design/` file.

## Tests and UI evidence required

Vitest render tests per state; Playwright screenshots of each state, light and dark, desktop and 390 px wide, attached to the PR.

## Dependencies

`depends-on: [LAI-533]`.

**Proceeds without any decision** (proposal §8): it shows proposed UI only, changes no design tokens and builds no live screen. The agent-colour choice is the owner's, made afterwards.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–1.5 days, confidence M.

## Branch

`LAI-536-agent-states-gallery`

## Migration / rollout notes

None; gallery only.

## Claim note — dependency deviation (SHELL, 2026-10-28)

`depends-on: [LAI-533]` is not in `.tasks/done/` on any branch. Claimed on
the orchestrator's (Belka / CHIEF) explicit dispatch, which cites proposal §8:
this task "proceeds without any decision" — it shows proposed UI only, builds
no live screen and changes no design token. Recorded here rather than read
loosely (§2 step 1).
