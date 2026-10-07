---
id: LAI-708
title: 'Cards glide between lanes, and another person’s change glows'
area: web
assignee: chief
priority: p1
depends-on: [LAI-707, LAI-473]
discovered-from: LAI-707
status: done
started: 2026-10-07T07:54:58Z
finished: 2026-10-07T08:18:37Z
---

## Goal

The owner, 2026-10-07: *"if that goes from To Do to In Progress, that will go
like an animation transition."* With LAI-707 the board no longer rebuilds, so
a card can be shown moving rather than jumping.

## Acceptance criteria

- [x] A card whose lane or place changes — by the person, by an optimistic
      reorder (LAI-473), its rollback, or a live change — glides there over
      200 ms `ease` using View Transitions; its shifted siblings slide too.
      Browsers without the API, `prefers-reduced-motion: reduce`, a hidden
      tab, a drag in progress and an open drawer all get the instant change.
- [x] Clicks are never blocked during a transition.
- [x] A card changed by anyone but the viewer (agents included) shows the
      design prototype's `flash` — a 3px accent ring fading over 3.6 s; the
      viewer's own move never does; under reduced motion it is a static ring
      for the same time. List rows get the glow, never a slide.
- [x] Browser tests prove each of the above, red first; a CSS scan proves the
      reduced-motion block.
- [x] A decision records that board motion is allowed and scopes the
      `theme.css` "Colour only. Nothing else animates." comment to its token.

## Notes / context

Absorbs LAI-254's *"a card that changes flashes"* criterion. Keys on LAI-473's
`data-task-id`. Plan: `board/board-layout.ts`, `board/board-motion.ts`,
`board/use-remote-touches.ts`, `board/board-motion.css`, a presenter hook on
`use-board.ts`'s `commit`.

## Delivery notes

- **Naming is measured, not predicted.** Before the change every card on screen
  is named; after it, only the cards that moved or arrived. Chrome does not
  hit-test a named card mid-glide, so a card standing still stays the live
  element and stays clickable. That replaces the planned `planMotion()` and
  `board-layout.ts`: neither was needed.
- **One glide at a time, then the queue.** A change that lands mid-glide waits
  and is shown as the next glide, all waiting changes together. A glide that
  moves nothing, such as the server agreeing, is skipped the moment that is
  known. So a refused move glides out and back, and an accepted one is never
  cut short. Mutation: skipping the running glide instead cuts it to about 2ms,
  and the keyboard test goes red.
- **Focus survives.** LaneRow refocuses after Alt+Arrow when it renders, which
  under a transition is a frame before the card moves. The transition puts the
  keyboard back on the same card if the change dropped it.
- `use-remote-touches` lives inside `board-motion.ts` as `useRemoteTouches`.
- Red first: against `master`'s `use-board.ts`, `BoardScreen.tsx` and
  `ListView.tsx`, six of the ten browser tests fail; the drawer and own-echo
  guards pass, as guards should.

## CHIEF — accepted 2026-10-07T08:19:05Z

Every criterion checked against the diff and the browser run:

- **Glide.** The keyboard move names the moving card before and after, for
  200ms with the root `running`, and leaves nothing behind. A live agent change
  glides. An optimistic drop leaves the carried card unnamed while its
  neighbours make room. A refused move glides back. Reduced motion, an open
  drawer and the List run no transition.
- **Clicks.** A card standing still during a slowed 3s glide takes the click,
  and its drawer opens.
- **Glow.** An agent's change glows. The viewer's own echo does not. Under
  reduced motion the glow is a still ring, with `steps(1, end)` timing. A List
  row glows.
- **Red first.** Six of the ten browser tests fail against master's three files,
  and the swaps were verified. The one-glide mutation went red on the duration
  assertion.
- **Decision.** D-071 is recorded, the `theme.css` comment is scoped to its
  token, and SPEC §11.4.1 is noted.
- **Gate on build-motion.** `pnpm test`, `pnpm lint` and `pnpm format` each
  exited 0. Server 2099, web 1295, cli 85.
