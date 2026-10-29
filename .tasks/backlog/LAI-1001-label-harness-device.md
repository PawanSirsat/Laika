---
id: LAI-1001
title: 'Every agent label reads <harness> · <device>; the wizard asks harness and device; the 409 links the existing agent'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-1000]
discovered-from: LAI-532
status: backlog
---

D-120 (owner decision in chat, 2026-10-29). Web half; the server half is
LAI-1000. Board: child of LAIKA-785 (Sprint 10, `phase-2-5`, `host-belka`).

## Goal

Wherever the owner sees an agent it reads *Omnigent · Belka*, *Claude Code ·
Strelka* — never a free-text name — and registering a second agent of one
harness on one device tells them which agent already exists and how to rotate
its credential instead.

## Scope

- One label function, `<harness> · <device>`, used everywhere an agent is
  named: card chip, drawer picker, List agent column and its filter, drawer,
  the session line (`Omnigent · Belka · Claude Code · <model>`), activity /
  History, dashboard, org activity, Agents tab, Devices view.
- The registration wizard asks harness and device, both required; no
  free-text name as a label (it may survive only as an optional private note
  that is never shown as the label). The name sent to the server is derived.
- On `409 agent_exists_for_device`: an inline message naming the existing
  agent, a link to it in the Agents tab and its Rotate action.
- Devices view: one row per harness under each device; a legacy duplicate is
  flagged (two active agents of one harness on that device).
- LAI-583's disambiguation (`twinNames`) stays only as the fallback for legacy
  duplicates.

## Acceptance criteria

- [ ] An agent registered as `Polly`, harness `omnigent`, device `Belka`
      reads `Omnigent · Belka` on every surface above
- [ ] The wizard has no free-text name field shown as the label; harness and
      device are required
- [ ] A `409 agent_exists_for_device` shows an inline message with a link to
      the existing agent and its Rotate action
- [ ] Devices view lists one row per harness under each device and flags a
      legacy duplicate
- [ ] Two legacy duplicates on one pair stay distinguishable (LAI-583 fallback)
- [ ] Both themes, 390 px and desktop, keyboard reachable
- [ ] Mutation-checked; touched tests, lint and format exit 0
