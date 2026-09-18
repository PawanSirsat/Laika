---
id: LAI-475
title: 'The lanes fill the page, and the rail collapses to widen the cards'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**Owner-reported, with a screenshot of the five lanes:** *"i want that the bottom
of page like in design ... also increase the task width"*. The lanes stop well
short of the bottom while the rail beside them runs on, and the cards are
narrower than the owner wants.

**Read D-062 first.** It carries the measurement, and the measurement is why
these two halves are not the same job:

- **The height is a defect.** `height: calc(100dvh - 21rem)` is a hand-tuned
  subtraction standing in for the chrome above it, already re-tuned once.
- **The width is not.** `docs/design/Laika 01 - Kanban Board.dc.html` and the
  shipped board have **the same 266px rail** and the same `1fr` lanes. At the
  owner's viewport our lanes are ~290px against the design's ~204px at 1600px.
  **Nothing is being reclaimed — the owner picked a trade.**

## Part 1 — the lanes fill the page

- [ ] **`calc(100dvh - 21rem)` is deleted, not corrected.** The lane's height
      comes from the layout: the board column fills what is left of the viewport,
      the lane strip fills that, the lane body scrolls inside it. **A corrected
      magic number fails this criterion** — the point is that nothing above the
      board can make it wrong again.
- [ ] **The lanes reach the bottom of the viewport**, asserted in a browser test
      by measuring the lane's bottom edge against the viewport's — **not** by
      asserting a CSS string. Check at **two viewport heights**, because one
      height is exactly what a magic number already satisfies.
- [ ] **The rail's bottom edge and the lanes' agree.** The owner's screenshot has
      the rail running past them, which is half of what makes it look wrong.
- [ ] **`+ Add task` stays pinned at the bottom of its lane** and does not scroll
      away with the cards — it is the behaviour LAI-270 built and this must not
      regress it.
- [ ] **The lane body still scrolls internally**, with the thin scrollbar, and
      `overscroll-behavior: contain` still holds. A full column must not scroll
      the page.
- [ ] **An empty lane still looks like a lane.** At full height, `Nothing in this
      lane` must not sit in a tall empty box — say what you did and show it in
      both themes.

## Part 2 — the rail collapses

- [ ] **A control collapses the live-stream rail to a thin strip and expands it
      again.** Labelled, reachable by keyboard, with `aria-expanded` — this is a
      disclosure, not a decoration.
- [ ] **Expanded is the default, and expanded stays 266px** — the design's
      figure, unchanged (D-062).
- [ ] **Collapsed, each lane gains the rail's width.** Assert the rendered lane
      width grows by roughly the rail's 266px spread across five lanes, measured
      in the browser before and after — not asserted as a CSS value.
- [ ] **The collapsed state is remembered across a reload**, per viewer.
- [ ] **Collapsed, the stream is still reachable** — one click, and it is not
      unmounted in a way that loses the events already received or drops the SSE
      subscription. Say which you did and why.
- [ ] **The board does not reflow into a horizontal scroll** in either state at
      the viewport the design targets.

## Both parts

- [ ] **Both themes**, including the collapsed strip and the control.
- [ ] **No new design tokens, no token values changed** (D-020).
- [ ] **No new dependencies.**
- [ ] Full gate — repo root, all three `EXIT 0`, each captured on its own line.

## Notes / context

**The measured design geometry**, so you do not have to re-derive it:

```
board row   display:flex; gap:12px; padding:14px 18px 18px; align-items:flex-start
lane strip  flex:1; min-width:0; display:grid; grid-template-columns:repeat(5,1fr); gap:11px
rail        width:266px; flex:none; display:flex; flex-direction:column; gap:12px
lane tub    background:var(--tub); border-radius:12px; padding:11px 9px 11px;
            display:flex; flex-direction:column; gap:9px          ← no border
```

**Ours differs in four small ways** — `minmax(12.875rem, 1fr)` where the design
has plain `1fr`, a `1px` border the design's tub does not have, `12px`/`10px`
padding against `11px`/`9px`, and `gap: 0.75rem` against `11px`. **Closing those
is worth about 4px of card width, which is not what the owner asked for** — do
them only if you want the fidelity, and say so separately. **They are not the
answer to the width request and must not be offered as it.**

**`align-items: stretch` on `.kanban` is LAI-270's and stays.** The design's row
is `flex-start`, but `stretch` is what stopped the ragged row the owner reported.
Making the lanes fill must not quietly return to `flex-start`.

**This is a new task rather than a note on one in review.** LAI-270, LAI-271 and
LAI-272 are all in `.tasks/review/` and their criteria are frozen (CLAUDE.md §2).
**LAI-272 is the one that set `21rem`** — it did so correctly for what it was
asked; this task removes the mechanism, not its arithmetic.

**Do not narrow the rail as a shortcut.** 266px is the design's number and
D-062 keeps it. The gain comes from collapsing, not from shaving.
