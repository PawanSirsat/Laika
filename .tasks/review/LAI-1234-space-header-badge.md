---
id: LAI-1234
title: 'Space header: the space''s own badge; Space settings in front, not behind ⋯'
area: web
assignee: shell
priority: p2
depends-on: []
status: review
started: 2026-11-17T11:50:00Z
finished: 2026-11-17T12:25:00Z
---

## Goal

The owner, with two screenshots: the rail shows a space as its coloured
letter (`SpaceBadge`) while the space's own header showed a fixed ink block
with a bar-chart glyph — make the logo consistent. And the ⋯ held one item,
Space settings: put it in front instead.

Base: local `ui-round9` @ 73049de1. Web only, no server changes, no new
dependencies. Local commits only, not pushed.

## Acceptance criteria

- [x] The header's tile is `SpaceBadge` (`md`), the same letter and colour
      the rail draws for the space; still hidden on a phone.
- [x] The ⋯ menu is gone; `SpaceSettingsLink` is a link chip — gear then
      *Space settings* — with the same href, client-side navigation and
      modified-click passthrough; on a phone the words are visually hidden
      and remain its accessible name.
- [x] The phone header stays within its 20% budget (the link is
      `border-box`, as the button was).
- [x] Tests that drove the ⋯ drive the link; the badge is asserted by its
      letter; guards that listed `SpaceMenu.tsx` list the new file or drop a
      scan that would now be vacuous.
- [x] Typecheck, eslint, prettier, the token guards (bar the pre-existing
      board-toolbar spacing failure on `ui-round9`) and the affected browser
      suites exit 0.
