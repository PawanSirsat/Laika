---
id: LAI-601
title: The sidebar scrolls away with the page
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-600
status: review
started: 2026-09-19T20:14:03Z
finished: 2026-09-19T20:14:03Z
---

## The defect

Scrolling the Timeline carried the whole rail up off the screen — the nav, the
theme switch and the user chip with it. The owner reported it happening "on a
few other pages as well", which is the useful half of the report: it is not a
Timeline bug.

**One cause.** `.shell` was `min-height: 100vh`, so on any screen taller than
the window the **document** scrolled, and the rail is `position: sticky`.
Sticky holds an element within its containing block while that block scrolls;
it cannot hold anything when the page itself is what is moving.

Measured at 1600x900 before the fix:

| screen | document scroll |
| --- | --- |
| timeline | **521px** |
| board, activity, capacity, list | 0 |

Which is why it looked like a Timeline problem: it is the screen that overflows
first. Anything tall enough does it.

## The fix

`.shell` is pinned to the viewport (`height: 100vh; overflow: hidden`) and
`.shell-main` becomes the one scroller (`flex: 1; min-height: 0; overflow-y:
auto`), with `min-height: 0` on `.shell-body` so it can shrink below its
content.

The rail then stays because **nothing it sits in ever moves** — which is a
stronger guarantee than making the sticky work harder.

Screens that manage their own scrolling are unaffected: the board pins its
lanes to the viewport and simply never overflows `.shell-main`. Verified
`docScroll = 0` on all six after.

## Acceptance criteria

- [x] The rail's `top` is unchanged after scrolling, on timeline, board,
      activity, capacity, dashboard and list.
- [x] The document itself never scrolls — the content pane does.
- [x] No horizontal overflow introduced on any of them.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
