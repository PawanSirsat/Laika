---
id: LAI-708
title: 'Cards glide between lanes, and another person’s change glows'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-707, LAI-473]
discovered-from: LAI-707
status: backlog
---

## Goal

The owner, 2026-10-07: *"if that goes from To Do to In Progress, that will go
like an animation transition."* With LAI-707 the board no longer rebuilds, so
a card can be shown moving rather than jumping.

## Acceptance criteria

- [ ] A card whose lane or place changes — by the person, by an optimistic
      reorder (LAI-473), its rollback, or a live change — glides there over
      200 ms `ease` using View Transitions; its shifted siblings slide too.
      Browsers without the API, `prefers-reduced-motion: reduce`, a hidden
      tab, a drag in progress and an open drawer all get the instant change.
- [ ] Clicks are never blocked during a transition.
- [ ] A card changed by anyone but the viewer (agents included) shows the
      design prototype's `flash` — a 3px accent ring fading over 3.6 s; the
      viewer's own move never does; under reduced motion it is a static ring
      for the same time. List rows get the glow, never a slide.
- [ ] Browser tests prove each of the above, red first; a CSS scan proves the
      reduced-motion block.
- [ ] A decision records that board motion is allowed and scopes the
      `theme.css` "Colour only. Nothing else animates." comment to its token.

## Notes / context

Absorbs LAI-254's *"a card that changes flashes"* criterion. Keys on LAI-473's
`data-task-id`. Plan: `board/board-layout.ts`, `board/board-motion.ts`,
`board/use-remote-touches.ts`, `board/board-motion.css`, a presenter hook on
`use-board.ts`'s `commit`.
