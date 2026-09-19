---
id: LAI-294
title: The Timeline grid pushes the whole page sideways
area: web
assignee: unclaimed
priority: p2
discovered-from: LAI-293
status: backlog
---

## What was measured

On `/timeline?project=laika-core`, against the seeded instance, both themes:

| width | page overflow |
| --- | --- |
| 1600 | 0 |
| 1280 | 47 |
| 900 | 215 |
| 420 | 695 |

The overflowing box is **`div.tl-grid`** — 1082px wide inside a 900px
viewport — and its children `.tl-head`, `.tl-head-axis`, `.timeline-months`.
It is the Timeline's own chart, not the space bar: `.space-bar-right` measures
183px at every width and the board and activity views are `0` at all four.

## Why it is filed rather than fixed

Found while measuring LAI-293 and **pre-existing** — LAI-293 changed the space
bar, and the space bar is not what overflows. §2 is one task at a time.

**No test covers it**, which is why it has survived: `activity-tab.test.ts`
asserts page overflow `0` at four widths on *its* screen, and there is no
equivalent for the timeline. That assertion existing on one screen and not
another is the actual gap.

## Acceptance criteria

- [ ] Page overflow is `0` on `/timeline` at 1600/1280/900/420, both themes.
- [ ] The grid scrolls **itself** — the day columns keep their width and
      `.tl-grid` becomes the scroll container, rather than the months being
      squeezed until they are unreadable.
- [ ] A test asserting the above, modelled on `activity-tab.test.ts`'s
      *"never pushes the page sideways, at any width"*.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
