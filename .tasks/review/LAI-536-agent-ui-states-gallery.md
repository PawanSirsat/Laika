---
id: LAI-536
title: 'Reviewable states for agent UI on /design/states — gallery only, no live screens'
area: web
assignee: shell
priority: p1
depends-on: [LAI-533]
discovered-from:
started: 2026-10-27T19:31:31Z
finished: 2026-10-27T19:51:41Z
status: review
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

- [x] Every state named in proposal §6 has a gallery entry (listed in the PR body against §6).
- [x] Exceptional states are spelled out in text, never by colour alone.
- [x] No new colour token; no `docs/design/` value changed (D-020).
- [x] The existing `created_via==='mcp'` badge keeps its meaning and is shown next to the agent chip so the difference is visible.
- [x] No fixture string from the gallery appears in the built bundle outside `/design/states` (asserted).
- [x] Repo-root gate exits 0.
- [x] Chips use only `--text-2` on `--bg-2` and the agent mark; `git diff` shows no change to any theme token or `docs/design/` file.

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

## Submission note (SHELL)

- **Token names.** The scope and AC name `--text-2` on `--bg-2`; neither token
  exists in `styles/theme.css`. The chip uses `--text-secondary` on
  `--chip-neutral-bg` (border `--chip-neutral-border`) — the existing neutral
  chip family, the same values in both themes as secondary text on the
  recessed surface. Asserted in `agent-states.test.ts` (rule) and
  `test/browser/agent-states.test.ts` (computed, both themes).
- **Bundle AC.** The gallery section is a lazy chunk; the fixtures land only in
  `AgentStateGallery-*.js`, proved by `agent-gallery-bundle.test.ts`, which
  went red when `StateGallery` was mutated to import it statically.
- **Render tests** are Playwright (`test/browser/agent-states.test.ts`), the
  repo's way of rendering components — `@laika/web` has no Vitest.
- **Out of scope, touched:** `state-gallery.css` grid floor is now
  `min(22rem, 100%)`; the existing gallery scrolled sideways at 390px.

## Review round 1 — Codex (cross-vendor), fixed on the same branch (SHELL)

- **Blocking 1, §6 coverage:** added Settings → Access hand-off policy (§4.5; defaults and other-owners-allowed), project context revisions with received-only wording (§4.6), and one specimen per wizard step plus verify waiting / verified / failed.
- **Blocking 2, disabled agents unreadable:** `Dropdown` gains opt-in `reachDisabled`; `AgentPicker` uses it. Tested: the arrow lands on a disabled agent, its accessible name carries the reason, Enter and Space do not choose it.
- **Suggestion:** `reason` is required by the type when `availability` is `unavailable` (compile-time test).
- **Non-blocking:** screenshots of the open picker with a disabled agent active, and of each inbox filter, light/dark × 1440/390.
