---
id: LAI-966
title: 'The board''s ⋯ overflow menu is positioned from the trigger''s right edge with no clamp, so on a phone it can open off the left of the screen'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-961
status: backlog
---

## Why

LAI-961 measured View settings opening at **x = -296** on a 390px-wide
viewport: it was placed with `right: <trigger's offset from the right edge>`,
and on a phone the trigger sits near the **left**, so a 350px panel ran off
the screen. LAI-961 clamped View settings only (`view-settings.css`).

`BoardScreen.tsx` positions the `⋯` overflow menu the same way —
`style={{ top: …overflowAt.top, right: …overflowAt.right }}`, no clamp — and
its trigger sits beside View settings in the same toolbar. **Not measured**;
this is filed from reading the code, so the first step is to measure it.

`ListMenu.tsx` already flips against `window.innerWidth` and is not this case.

## Acceptance criteria

- [ ] At 390px and 1440px, light and dark, the `⋯` menu opens fully inside
      the viewport (browser test asserting its bounding box, red first).
- [ ] At 1440 it still opens under its trigger.
- [ ] Gate exit 0.
