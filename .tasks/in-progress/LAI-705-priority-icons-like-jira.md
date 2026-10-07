---
id: LAI-705
title: 'Priority is drawn as Jira draws it — an up chevron, an equals sign, a down chevron'
area: web
assignee: chief
priority: p2
depends-on: []
status: in-progress
started: 2026-10-07T07:40:28Z
---

## Goal

The owner's two crops of Jira's priority icons, 2026-10-07: *"for priority use
this kind of icon properly"*. A red chevron up, an orange equals sign, a blue
chevron down (and Jira's doubled chevrons at the extremes). Laika draws a
coloured dot on the card and the text `P1` in the List and the task view.

## Acceptance criteria

- [ ] One `PriorityIcon` component draws Laika's three levels as Jira draws
      the middle three: **P1 a red up chevron (High), P2 an orange equals sign
      (Medium), P3 a blue down chevron (Low)** — an inline SVG in
      `currentColor`, its name in a `<title>` and a visually-hidden label, so
      the colour is never the only signal.
- [ ] It replaces the priority dot on the card, sits beside the `P1` text in
      the List's PRI column, and beside the priority control in the task
      view's Details card.
- [ ] Colours come from existing tokens only (D-020): `--overdue` for P1,
      `--chip-orange` for P2, `--chip-blue` for P3. Both themes.
- [ ] Browser tests: each level draws its own glyph and name on the card, the
      List and the task view; a P3 card no longer draws a dot.

## Notes / context

Owner-directed, filed and built by CHIEF. **Three levels, not Jira's five.**
`TASK_PRIORITIES` is `p1 | p2 | p3`, shared by the REST API, the policy layer
and the MCP tools that agents call; adding Highest and Lowest is a schema and
tool-contract change for every owner, and the owner asked for the icons, not
the levels. D-070 records the mapping.
