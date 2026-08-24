---
id: LAI-088
title: Shell fidelity — sidebar ground, brand tile, nav rhythm
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-25T04:40:00+05:30
---

## Goal

From Builder-B's gap list against `Laika Prototype.dc.html`. **The remote
prototype is byte-identical to our local copy** — so none of this is a stale
reference. It is our implementation drifting from a source that never moved.

**No API, no new colour values** (D-020). Every value below is already a token.

## Acceptance criteria

- [ ] **Sidebar ground `var(--card)`, not `var(--tub)`.** The single most visible
      error, and it is wrong on every screen.
- [ ] **Brand is the 28px tile with the glyph**, not a 20px flat accent dot —
      the same treatment `Brand variant="tile"` already provides from LAI-074.
- [ ] Border-bottom under the brand block.
- [ ] **4×14px accent bar** on the active nav item.
- [ ] Group labels in the **UI font at 8.5px/800, `.1em`** — not mono at `.06em`.
- [ ] Nav items at a fixed **31px**.
- [ ] Footer order corrected: **user chip above the theme control**, and the role
      in **`var(--pur)`** rather than `--tx2`.
- [ ] **Keep all three theme options.** Match the prototype's placement and
      shape only — it shows a two-way toggle because a mockup has no OS to
      follow. Dropping `System` would be a regression (LAI-064 AC4).
- [ ] Both themes, checked **through the real theme control**.

## Notes / context

**Supersedes LAI-210** (first-boot tile mark) — the tile arrives here for the
whole shell. Close LAI-210 when this lands.

Ship as its own commit so review stays screen-by-screen.
