---
id: LAI-252
title: 'The task drawer chrome: 840px over a dimmed board'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-251]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase A4 of the owner-approved prototype rebuild (2026-09-18). A task opens as
a **drawer over the dimmed board** (prototype lines ~360–367), not a side
panel: the board stays mounted underneath, scroll position and data intact.

- `src/components/drawer/TaskDrawerShell.tsx` + `drawer.css` — the chrome
  only: `width: min(840px, 100%)`, right-anchored over the content pane,
  scrim `rgba(15, 23, 42, .45)` (the sidebar stays interactive), `slidein
  .2s ease`, closed by scrim click, Escape, and the `×` button.
- Hosted by `SpaceLayout` on `?task=<id>`: opening pushes history so Back
  closes; closing strips the param.
- The **existing** `TaskDetailPanel` content renders inside unchanged — the
  drawer's content is LAI-248's plan Phase B4, not this task. `BoardScreen`
  stops owning the overlay.

## Acceptance criteria

- [ ] At ≥ 900px viewport the drawer is 840px wide; below, full width. Scrim
      covers the content pane; the sidebar remains clickable.
- [ ] Opening a card sets `?task=`, plays the slide-in, and the board behind
      keeps its scroll position through open and close (browser-tested).
- [ ] Scrim click, Escape, and `×` each close it; browser Back closes it;
      Forward re-opens it.
- [ ] The drawer works on every space view that lists tasks, not only the
      board (a row click on any view with task rows opens it).
- [ ] `BoardScreen` no longer renders its own overlay; superseded overlay CSS
      is deleted in this task.
- [ ] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each with
      the drawer open.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Keyframe `slidein` comes from LAI-251's `space/animations.css`
(`prefers-reduced-motion` guarded). An unpositioned scroll container cannot
clip absolutely-positioned descendants (the LAI-245 lesson) — the drawer is
`position: absolute` against the space layout's positioned content pane, so
the pane must be `position: relative`. No new dependencies.
