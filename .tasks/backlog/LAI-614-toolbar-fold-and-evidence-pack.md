---
id: LAI-614
title: Fold the board toolbar into the header; the prototype evidence pack
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-605
status: backlog
---

## Goal

The two pieces of LAI-605's brief that its review does not claim. First the
structural one: the prototype has no separate toolbar row, and ours still has
one - search, member stack, Filter, Group and four icons below WORKING NOW.
The fold mapping was posted to the owner (search and members to the bar's own
controls, Filter to the Priority position, Group/insights/settings/refresh
into the header "…" menu) and never vetoed; executing it is this task. Second
the evidence: the brief's Done-when screenshots (ours vs the prototype at
1440 and 1920, dark then light, same scroll) and the per-element delta list.

## Acceptance criteria

- [ ] No separate toolbar row; the header carries the prototype's layout; no
      control loses its function (the fold list is the contract).
- [ ] The board claims/unclaims bar filtering correctly on every view.
- [ ] Screenshot matrix and delta list delivered to the owner.
- [ ] Light theme verified against the prototype's :root, not only dark.
- [ ] Repo-root workspaces green, each exit code read standalone (LAI-480).

## Notes / context

- The fold touches SpaceTopBar/BoardToolbar composition - coordinate with the
  TanStack Query session if its migration has started by then; it asked to be
  told before screen composition changes.
