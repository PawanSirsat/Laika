---
id: LAI-283
title: The lanes fill the window instead of guessing at it
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-281
started: 2026-09-18T22:40:00Z
---

## Why

Owner report with a screenshot: the board's columns stop well above the bottom
of the window, with dead space under them. *"Increase the height to the bottom."*

The lanes were `height: calc(100dvh - 21rem)` — one number standing in for the
height of every band above the board. It had to be re-guessed each time any of
them changed, and after LAI-281 moved the right rail to its own tab it was
**99px short**.

## What

The height is measured now rather than described:

- `.space` is `100dvh`.
- `.board` and `.board-main` grow inside it (`flex: 1; min-height: 0`), and
  `.board-main` is `align-items: stretch` rather than `flex-start`.
- `.lane` has **no height at all** — a grid item stretches to its row.

## Acceptance criteria

- [x] The lanes reach the bottom of the window.
- [x] Their height follows the window: 900px and 700px give heights differing by
      exactly 200.
- [x] Each lane body still scrolls its own cards.
- [x] No space screen has content below the document's scrollable area, at 900
      or 700.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes

**`height: 100%` was the first fix and it was wrong.** It worked on a short
board and failed on a full one, which is the worst way for a layout to be wrong.
`.shell` is `min-height: 100vh`, so its height comes from its content — which
includes the lanes. A percentage chain ending in `min-height` is **circular**,
and it resolved to `auto`: the lanes grew to fit their cards (3457px of lane in
the harness) and the page scrolled instead. `100dvh` is the one anchor that does
not depend on what is inside; `dvh` rather than `vh` because mobile browsers
shrink the viewport as their chrome retracts.

**A test caught it, which is the part worth recording.** `task-drawer`'s
*"the board underneath keeps its scroll position"* carries a positive control —
*"the lane did not scroll, this proves nothing"* — and that is what went red. The
assertion it guards would have passed either way. Without it the broken layout
would have reached the owner a second time.

**Two of my own probes reported the wrong culprit today.** One blamed the view
tabs for horizontal overflow when they sit in a container that scrolls
correctly; one reported 8428px of the dashboard as "unreachable" when those
were rows inside the feed's own scroller. A probe that asks *"does this box
extend past the viewport"* is asking the wrong question — the right one is
*"does this element's own `scrollWidth` exceed its `clientWidth`"*, or for
reachability, *"is it outside every scrollable ancestor"*.

**The new test asserts two window heights.** One cannot tell a measured height
from a constant that happened to be tuned for it.
