---
id: LAI-244
title: '`.visually-hidden` escapes any scroll container and widens the document'
area: web
priority: p2
status: backlog
assignee: unclaimed
depends-on: []
discovered-from: LAI-243
created: 2026-09-18
---

## Why

`.visually-hidden` (`src/index.css`) is the canonical recipe and is **correct as
far as it goes**:

```css
.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
```

**It has no coordinates**, so each one sits at its *static* position. Inside a
horizontally scrolled container that position can be far right of the viewport —
and because the element's containing block is the nearest **positioned**
ancestor, an unpositioned scroller does not clip it. It escapes, and the
**document** grows.

**Measured on a seeded instance** (LAI-243): the board gained a 146px horizontal
page scrollbar at 1280px while every box in the layout was correct. The only
elements whose right edge reached the document's width were two
`span.visually-hidden` and their `<b>` siblings inside the rail's activity feed.

## What is already done, and why it is not enough

LAI-243 added `position: relative` to `.board-main`, which makes that scroller
the containing block and clips them. **That fixes one scroller.** Any future one
inherits the bug, and the failure mode is a page scrollbar with no visibly
oversized element — which cost several rounds of bisecting to locate.

## Acceptance criteria

- [ ] `.visually-hidden` cannot widen the document from inside a scroll
      container, **without** each container having to remember `position:
      relative`.
- [ ] **A test that fails against today's rule.** Put a `.visually-hidden` inside
      an unpositioned `overflow-x: auto` box whose content is scrolled, and
      assert `documentElement.scrollWidth === clientWidth`. Write it red first.
- [ ] **Screen-reader behaviour is unchanged.** Reading order is DOM order, not
      visual position, so pinning coordinates is safe — but say what was checked
      rather than asserting it.
- [ ] LAI-243's `position: relative` on `.board-main` is **reviewed, not
      reflexively removed**: a scroll container being the containing block for
      its own descendants is defensible on its own terms. Keep or drop it
      deliberately and say which.
- [ ] Full gate — **`pnpm test` `EXIT 0`**, repo root.

## Notes

The likely fix is coordinates (`top: 0; left: 0`) so the element never sits at a
static position that can be anywhere. Verify rather than assume: `margin: -1px`
interacts with this, and the point of the recipe is that it stays in the
accessibility tree.
