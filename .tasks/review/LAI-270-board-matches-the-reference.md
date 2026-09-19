---
id: LAI-270
title: 'The board matches the reference: tabs, filter row, columns, card divider'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-269
started: 2026-09-18T17:31:07+05:30
finished: 2026-09-18T17:42:17+05:30
status: review
---

## Goal

The owner put the Claude Design render beside our board. Four differences are
obvious side by side, and all four are ours to fix.

1. **Tabs.** The reference: `Board · List · Timeline · Calendar · Sprints ·
   Capacity · Dashboard · Meeting review 4`. Ours omits **List**, omits
   **Calendar**, and puts the count badge on Sprints instead of Meeting review.
2. **A filter row the reference does not have.** Ours renders a whole second
   band — `Any tag`, `Anyone`, `Ready only`, `Board | List`. The design has
   no such row: filters live in the top bar, and Board/List are tabs.
3. **Columns.** The reference's columns are equal-height panels that scroll
   internally, with `+ Add task` pinned to the bottom of each. Ours grow to fit
   their cards, so the columns are ragged and the page scrolls instead.
   Ours also puts a `Backlog ⌄` status select under **every card**; the
   reference has no such control.
4. **Cards.** The reference draws a rule between the tag pills and the footer.
   Ours has none.

## Acceptance criteria

- [x] `List` is a tab and `/list` is a route; the Board/List toggle leaves the
      board.
- [x] The count badge is on `Meeting review`, from its real pending count, and
      off `Sprints`.
- [x] The second filter band is gone. Tag, assignee, priority and ready-only
      live in the top bar beside Search, and priority reads `Priority: all` as
      a dropdown rather than a cycling button.
- [x] Columns are equal height, scroll internally past a threshold, and keep
      `+ Add task` pinned at the bottom.
- [x] The per-card status select is no longer a visible control **and the
      keyboard can still move a task** — it is the only non-mouse way to, so it
      is hidden until focus rather than deleted.
- [x] A rule sits between a card's tags and its footer.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**Calendar is not in this task.** It needs `tasks.due_date`, which does not
exist; a tab leading to an empty screen is worse than no tab (§5.1 forbids the
placeholder). It arrives with the endpoint.

**The filters are ours, not the design's.** The reference's top bar carries
only `Priority: all` because that prototype had one filter. Ours has four, and
they go where the design puts filters — the top bar — rather than in a row the
design does not have.

## Completion notes

Measured on the running instance: five lanes at **764px each**, equal; the
second filter band is gone; the tab strip reads `Board · List · Timeline ·
Sprints · Capacity · Dashboard · Meeting review`.

**`align-items: start` was what made the columns ragged.** Each sized to its
own cards. `stretch` plus one height on the lane, with the body scrolling
inside it, is the reference's shape.

**Four existing tests failed on this and all four were right to.** Each
asserted the old arrangement, and each was repointed rather than loosened:

- the priority cycler became a dropdown, so the test selects instead of
  clicking;
- two tab lists gained `List`;
- `task-drawer`'s "the board underneath survives" scrolled the **window** —
  the board no longer grows the document, so there was nothing to move. It
  scrolls the lane now, which is the thing that scrolls.

**The status select is clipped, not deleted.** Drag has no keyboard story and
this is the only other way to move a task; it returns to the flow on focus, and
a test asserts both halves — under 2px at rest, taller once focused.

**Calendar is still not a tab**, for the reason in the Notes: no
`tasks.due_date`, and a tab onto an empty screen is worse than none.

**The Meeting review badge renders from the real pending count** and is absent
here because the seeded instance has no reviews — a webhook creates them.
