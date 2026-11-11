---
id: LAI-1198
title: 'One consistent space header, a calmer board toolbar, and an honest board scope'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-1140
status: review
started: 2026-11-11T10:00:00Z
finished: 2026-11-11T16:30:00Z
---

## Goal

The visual audit (`.polly/proposal/visual-audit.md`, findings 3–6) found the
space header changing layout from tab to tab, falling apart at 390, a board
toolbar of eleven controls with five unlabelled icons, and a board that opens
on one sprint without saying so clearly. Fix all four in `server/web/` only.

Stacked on PR #289 (`LAI-1140-drawer-host`). Does not change how the drawer
opens.

## Acceptance criteria

- [x] One space header for every space tab (Board, List, Timeline, Calendar,
      Sprints, Dashboard, Activity, Meeting review): title row (space name,
      live indicator) / tab row / one toolbar row (search, filters,
      view-specific controls, + Create always in the same place). No filter
      in the title row.
- [x] At 390: compact title, horizontally scrollable tabs with an edge cue,
      filters collapse into one `Filters` button opening a sheet; content
      starts within ~15% of the viewport.
- [x] Board toolbar: search, filter and group visible; hidden columns, view
      settings, insights and refresh in a labelled overflow menu; every icon
      button has an accessible name.
- [x] A sprint-scoped board says so (`S2 · Sprint name · 8 of 22 tasks`) with
      one-click `Show all sprints`; the default stays the active sprint.
- [x] The sprint badge is visually distinct from the size chip.
- [x] Both themes, 390/768/1024/1440, keyboard, screen reader, reduced
      motion, theme tokens only (`theme.css` untouched).
- [x] Playwright tests for header structure across tabs, 390 layout,
      overflow keyboard, `Show all sprints`, each mutated once to prove it
      fails.
- [x] Gate: `pnpm lint`, `pnpm format`, web typecheck, the new and existing
      space-bar/board/list browser tests each exit 0.

## Submission note (SHELL, 2026-11-11)

Stacked on PR #289 (`LAI-1140-drawer-host`). Overlaps, kept minimal:
#315 (its `SprintKey` would replace `.sprint-key` / the card pill here; no
screen body of dashboard, sprints or timeline was edited), #318 (tab markup
unchanged — only `data-more-*` on the `<nav>` and a ref on the `<ul>`),
#280 (no calendar or activity file edited), #287 (BoardScreen: the toolbar
props, the `⋯` menu and the scope). The drawer's opening is untouched.

Choices worth checking: the Agents chip stays in the title row (space-wide
presence, not a tab's filter); the fold is keyed to the toolbar's width
(880px), not the window; "content starts within ~15%" is measured as the
header's bottom edge (128px of 844 at 390, 15.2%).
