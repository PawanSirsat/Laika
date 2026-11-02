---
id: LAI-1082
title: 'Developer access design: Project setup as a three-step wizard, with a setups list'
area: shell
assignee: shell/belka
priority: p2
depends-on: [LAI-1077, LAI-1078]
discovered-from: LAI-1075
status: review
started: 2026-11-02T11:10:00+05:30
finished: 2026-11-02T12:52:00+05:30
---

## Why

The owner's V3 design draws Project setup as a three-step wizard with a rail,
an aside and a list of existing setups; today it is one long card.

## Acceptance criteria

- [x] `?step=1|2|3|done` with `?project=` and `?tool=`.
- [x] Step 1: project and tool selects; authorization row (level chip, "You ·
      In effect" line, "Change" reveals the three radios + Save access);
      not granted → "Grant required" block; `agents_allowed` warning kept;
      Continue disabled until granted.
- [x] Step 2: detail tiles (Project, Target instructions file), the prompt
      with Copy, "Or edit the file yourself", repo MCP note for VS Code and
      Omnigent, the bare block for tools with no file.
- [x] Step 3: `laika project check` (the only *Checked*) with a live status,
      or "I’ve added it" (self-report, not verified).
- [x] Done card with detail tiles; "Set up another repository →".
- [x] Setups list ("View existing setups") from LAI-1077's read.
- [x] Aside "What stays separate" and "What the prompt changes" (hidden
      ≤ 1040px); rail becomes a strip on a phone.
- [x] Tests: `project-setup` updated to steps; gating; both themes; 390px.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
