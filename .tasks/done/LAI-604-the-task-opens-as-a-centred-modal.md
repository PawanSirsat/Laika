---
id: LAI-604
title: A task opens as a centred modal, not a right-hand drawer
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-602
status: done
finished: 2026-09-20T19:00:38Z
started: 2026-09-19T21:01:11Z
---

## Why

The owner's reference opens a task as a dialog floating over the board, clear
of every edge. Ours was docked to the right edge, full height.

**Only the placement moves.** LAI-285's two columns — the task as a document
beside a 288px field rail — are untouched, so the description keeps its width.

`1120 × 774` at 1600×900, inset 240px left and right, 63px top and bottom;
scrim covers the whole window including the rail, because a modal dims
everything behind it.

## The trap in it

The open animation slid in from the right edge with `translateX`. A centred
dialog is *positioned by* a transform, so animating `translateX` alone throws
it half a screen left for the length of the animation. It rises 12px instead,
keeping `translate(-50%, -50%)` in both keyframes.

## Id

Not `LAI-603` — the other SHELL session filed that first for their lane-head
work and I had been calling this that. Checked across every branch immediately
before claiming.

## Acceptance criteria

- [x] The dialog is centred, clear of all four edges, with an even shadow.
- [x] The scrim covers the rail too.
- [x] Never taller than the viewport.
- [x] The two-column content is unchanged.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Closure note (2026-09-21)

Built, shipped and deployed; the move to review was overtaken by the owner's
rapid-fire briefs. Still true as written - the modal survived the later
restyles unchanged apart from tokens.
