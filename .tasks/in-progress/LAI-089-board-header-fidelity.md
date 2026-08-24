---
id: LAI-089
title: Board header fidelity — surface, rhythm, and the search field
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-065, LAI-088]
discovered-from:
status: in-progress
started: 2026-08-25T05:40:00+05:30
---

## Goal

The second half of Builder-B's gap list. Depends on **LAI-065**, which builds the
header's behaviour — this is its appearance.

## Acceptance criteria

- [ ] Header sits on **`var(--card)` with a divider**, not transparent.
- [ ] Title `Board` at **15px/800**, with the project as a **10px subtitle**.
- [ ] Search is a **31px bordered field with a magnifier and the `/` hint inside
      it** — not prose underneath.
- [ ] Every control on the **31px height / 9px radius** rhythm.
- [ ] Both themes, through the real control.

## Explicitly NOT in this task

Data-backed chrome, which is why it is not in the sweep:
`LIVE · SSE` (LAI-070) · `WORKING NOW` presence (M5) · the sprint strip
(Builder-A's under D-029) · the `Agent work` filter (no `created_via` filtering
exists).

And nothing from the fixture list: tags, WIP limits, `postgres 16`, `13/34`,
`Mira Kellner`, `v0.4`.
