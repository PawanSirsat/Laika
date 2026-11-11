---
id: LAI-1198
title: 'One consistent space header, a calmer board toolbar, and an honest board scope'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-1140
status: in-progress
started: 2026-11-11T10:00:00Z
---

## Goal

The visual audit (`.polly/proposal/visual-audit.md`, findings 3–6) found the
space header changing layout from tab to tab, falling apart at 390, a board
toolbar of eleven controls with five unlabelled icons, and a board that opens
on one sprint without saying so clearly. Fix all four in `server/web/` only.

Stacked on PR #289 (`LAI-1140-drawer-host`). Does not change how the drawer
opens.

## Acceptance criteria

- [ ] One space header for every space tab (Board, List, Timeline, Calendar,
      Sprints, Dashboard, Activity, Meeting review): title row (space name,
      live indicator) / tab row / one toolbar row (search, filters,
      view-specific controls, + Create always in the same place). No filter
      in the title row.
- [ ] At 390: compact title, horizontally scrollable tabs with an edge cue,
      filters collapse into one `Filters` button opening a sheet; content
      starts within ~15% of the viewport.
- [ ] Board toolbar: search, filter and group visible; hidden columns, view
      settings, insights and refresh in a labelled overflow menu; every icon
      button has an accessible name.
- [ ] A sprint-scoped board says so (`S2 · Sprint name · 8 of 22 tasks`) with
      one-click `Show all sprints`; the default stays the active sprint.
- [ ] The sprint badge is visually distinct from the size chip.
- [ ] Both themes, 390/768/1024/1440, keyboard, screen reader, reduced
      motion, theme tokens only (`theme.css` untouched).
- [ ] Playwright tests for header structure across tabs, 390 layout,
      overflow keyboard, `Show all sprints`, each mutated once to prove it
      fails.
- [ ] Gate: `pnpm lint`, `pnpm format`, web typecheck, the new and existing
      space-bar/board/list browser tests each exit 0.
