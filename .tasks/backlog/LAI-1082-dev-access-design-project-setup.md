---
id: LAI-1082
title: 'Developer access design: Project setup as a three-step wizard, with a setups list'
area: shell
assignee: unclaimed
priority: p2
depends-on: [LAI-1077, LAI-1078]
discovered-from: LAI-1075
status: backlog
---

## Why

The owner's V3 design draws Project setup as a three-step wizard with a rail,
an aside and a list of existing setups; today it is one long card.

## Acceptance criteria

- [ ] `?step=1|2|3|done` with `?project=` and `?tool=`.
- [ ] Step 1: project and tool selects; authorization row (level chip, "You ·
      In effect" line, "Change" reveals the three radios + Save access);
      not granted → "Grant required" block; `agents_allowed` warning kept;
      Continue disabled until granted.
- [ ] Step 2: detail tiles (Project, Target instructions file), the prompt
      with Copy, "Or edit the file yourself", repo MCP note for VS Code and
      Omnigent, the bare block for tools with no file.
- [ ] Step 3: `laika project check` (the only *Checked*) with a live status,
      or "I’ve added it" (self-report, not verified).
- [ ] Done card with detail tiles; "Set up another repository →".
- [ ] Setups list ("View existing setups") from LAI-1077's read.
- [ ] Aside "What stays separate" and "What the prompt changes" (hidden
      ≤ 1040px); rail becomes a strip on a phone.
- [ ] Tests: `project-setup` updated to steps; gating; both themes; 390px.

## Notes

- SHELL, `server/web/` only. PR into `integration-dev-access-design`.
