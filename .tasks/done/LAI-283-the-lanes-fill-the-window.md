---
id: LAI-283
title: The lanes fill the window instead of guessing at it
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-281
started: 2026-09-18T22:40:00Z
finished: 2026-09-18T22:52:00Z
reviewed: 2026-09-19T10:40:00Z
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

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

**Verified specifically.** The falsifiable criterion is AC2, and it passes
exactly: lane height at 900px and 700px viewports measured **716 and 516 — a
difference of exactly 200**. That is what distinguishes a measured height from a
constant tuned for one window, and it is why this criterion was the right one to
write. `document.scrollHeight <= innerHeight` at both heights, so nothing sits
below the scrollable area. The lane body scrolls at 700 and does not at 900,
which is correct rather than inconsistent.

`calc(100dvh - 21rem)` is gone from `board.css`. The 50px below the lanes is
fully accounted: 18px `.board-main` padding + 32px `.kanban { margin-bottom:
var(--space-6) }` — `--space-6: 2rem`. **`.board-main` reaches y=900 of a 900px
viewport exactly.** The `margin-bottom` is a leftover from when the board
scrolled; filed, not held against this.
