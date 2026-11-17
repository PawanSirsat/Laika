---
id: LAI-1230
title: 'Board toolbar: split the ⋯ menu back into its own buttons; floating menus get a shadow token'
area: web
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-11-17T10:00:00Z
---

## Goal

The owner, with a screenshot of the board toolbar ("All sprints | DONE 4/24 |
BLK 1 | LEFT —" then a single ⋯ with a dot): put the board toolbar's ⋯
overflow back into its original format — separate icon buttons, as before
LAI-1198 folded them in — and give menus and popovers a visible drop shadow
so they read as floating above the content.

Base: local `ui-round9` @ bb825910. Web only (`server/web/`), no server
changes, no new dependencies. Local commits only, not pushed.

## Acceptance criteria

- [ ] The ⋯ menu and its dot are gone from the board toolbar. View settings,
      Insights, Refresh and Hidden columns are separate icon buttons again,
      in the pre-LAI-1198 order (Hidden columns, Insights, View settings,
      Refresh), each with its accessible name and the shared Tooltip.
- [ ] Hidden columns shows its count on its own button, and is drawn only
      when there is a hidden column the reader may restore.
- [ ] On phone widths the toolbar stays usable and does not widen the page.
- [ ] Menus, popovers and dropdowns use an elevation token from `theme.css`
      (light, dark and black), applied in the shared surfaces, with no
      per-screen raw box-shadow; reduced-transparency / high-contrast
      fallbacks still work.
- [ ] Tests that asserted the ⋯ menu assert the separate buttons, their
      names, and that the shadow token is used.
- [ ] Typecheck, lint, format, the structure test, the affected browser
      tests and the web build exit 0.
