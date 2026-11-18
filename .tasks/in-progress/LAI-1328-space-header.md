---
id: LAI-1328
title: 'Space header: drop the "Spaces /" breadcrumb, a slightly larger space mark'
area: web
assignee: chief
priority: p2
depends-on: []
status: in-progress
started: 2026-11-18T07:47:00Z
---

## Goal

Board card LAIKA-1098. The owner, 2026-11-18, from a screenshot of a space's header on Ksage
(Skynet): remove the *Spaces /* breadcrumb above the space name, and make the logo a little
bigger, but not much. CHIEF dispatched it to builder session laika-c4.

## Contract

- **The crumb.** In `server/web/src/components/space/SpaceTopBar.tsx`, the crumb nav
  (`data-space-crumbs`) goes. The space's name heading and its mark stay.
- **The mark.** `ProjectMark size="md"` becomes the next step, `lg`. The name, key and LIVE
  chips stay on one row.
- **Tests.** The tests that pin the crumb are updated: space-bar, space-header,
  header-actions, board-bands and loading-sweep.
- **Comments.** The comments that mention *Spaces /* are corrected in ShellHeader.tsx,
  header-model.ts, SpaceLayout.tsx, space.css and ScreenHeader.tsx.

## Acceptance criteria

- [ ] No *Spaces /* crumb on any space page
- [ ] The mark is one size larger and stays aligned with the name
- [ ] Screenshots in light and dark, at 1440 and 390
- [ ] CI green; CHIEF releases to master and Ksage
