---
id: LAI-1118
title: 'Task detail on a phone: bottom sheet with a drag handle'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-1117]
discovered-from: LAI-1117
status: backlog
---

## Goal

The 2026-11-04 design draws the task detail at 390px as a bottom sheet: a
drag handle, one column in the order title, status, delivers and state hero,
description, acceptance, details, development and estimate, activity, foot;
fact grids two columns. Today the panel only stacks below 900px.

## Acceptance criteria

- [ ] Below 600px the drawer is a sheet from the bottom with rounded top
      corners and a handle; the scrim, Escape and focus return behave as on
      desktop; a swipe down or the handle closes it (keyboard: Escape).
- [ ] The column order above, implemented with CSS `order` on the existing
      sections — no second render tree.
- [ ] Fact grids two columns; nothing wider than the viewport; the "Who did
      this" popover fits inside it.
- [ ] Browser tests at 390px in both themes: order, no sideways scroll, close
      paths. Desktop tests unchanged.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0.

## Notes / context

Filed from the redesign plan; the owner chose desktop first.
