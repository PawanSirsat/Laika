---
id: LAI-273
title: The Timeline to the design — shared chips, real bars, one today line
area: web
assignee: shell
status: in-progress
priority: p1
depends-on: []
discovered-from: LAI-256
started: 2026-09-18T19:05:00Z
---

## Why

Screen 3 of the owner's page-by-page pass. Measured against prototype lines
204–233 (the chips) and 521–580 (the chart).

Five differences, in the order they matter:

1. **The Timeline had grown a second sprint-chip implementation.** The design
   derives the board's row and the timeline's from one `sprintChips` (lines 151
   and 209); ours had `tl-tab*` — its own markup, its own local selection state,
   and its own idea of what a fraction is. Picking S2 on the board and switching
   to Timeline silently reverted to the current sprint.
2. **The bars carried no key.** The design writes the task key inside the bar
   (line 563); ours drew an unlabelled block with a dot, so a track of them
   could not be read without tracing each back across 400px of names.
3. **The task column was 24rem** against the design's 250px — a third of a
   1200px window for names, with every bar squeezed into what was left.
4. **`in_progress` reached the screen.** The design writes the lane's name.
5. **No legend.** The design closes the card with one (lines 574–579), and it
   carries the only thing a reader cannot work out by looking: what the grey
   columns between sprints are.

## What

- `SprintStrip` is now the Timeline's chip row too, rendered in `SpaceBand` —
  the same component, the same position, and `?sprint=` as the selection for
  both screens. `tl-tabs` and its local state are gone.
- The bar is the design's: 24px, radius 7, its key inside, the blocker's key
  beside a lock. The greyscale dot stays — see the note below.
- `--tl-label` is 250px, `box-sizing: border-box`; rows have the design's 46px
  floor; the card takes the 12px radius and the shadow.
- One today marker for the whole card, amber and solid, with `TODAY · FRI 18
  SEPT` at the top.
- The legend, with the design's four swatches and its sentence.

## Acceptance criteria

- [x] The Timeline and the board render the **same** chip component, and a
      sprint picked on one is still picked on the other (`?sprint=`).
- [x] Every bar shows its task key; a blocked bar shows the blocker's key.
- [x] The task column measures exactly 250px, and rows are one height.
- [x] Exactly **one** today marker, amber, with the date pill in the header.
- [x] The lane reads `In progress`, never `in_progress`.
- [x] The legend renders its four items.
- [x] Page overflow `0`; full gate — all three `EXIT 0`, repo root.

## Notes

**The claim commit is late**, as on LAI-272: this is an owner-directed pass over
a running instance, and the file is written at submission rather than back-dated.

**The blocked dot stayed, beside the design's lock.** `timeline-blocked-and-
tabs.test.ts` holds the blocked treatment to a **non-colour** difference, and
the first version of this replaced the dot with the lock-and-key. That reads
better and is strictly worse: the bar is `overflow: hidden`, so on a one-day bar
the text clips away and only the colour would have been left. The dot survives
any width. The guard caught it, which is the guard working.

**Two today markers could not be made to agree.** Drawing one in the header and
one over the rows put them 12px apart — the header measures the axis, the body
measures the axis *plus* the 250px task column. Fixed by drawing the fact once,
against the card. Two elements for one fact will always find a way to disagree.

**`--weight-regular` does not exist.** `tokens.test.ts` caught it on the first
run; the scale is `normal/medium/semibold/bold/heavy`.
