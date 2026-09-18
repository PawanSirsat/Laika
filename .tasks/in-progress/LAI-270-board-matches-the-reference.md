---
id: LAI-270
title: 'The board matches the reference: tabs, filter row, columns, card divider'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-269
started: 2026-09-18T17:31:07+05:30
status: in-progress
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

- [ ] `List` is a tab and `/list` is a route; the Board/List toggle leaves the
      board.
- [ ] The count badge is on `Meeting review`, from its real pending count, and
      off `Sprints`.
- [ ] The second filter band is gone. Tag, assignee, priority and ready-only
      live in the top bar beside Search, and priority reads `Priority: all` as
      a dropdown rather than a cycling button.
- [ ] Columns are equal height, scroll internally past a threshold, and keep
      `+ Add task` pinned at the bottom.
- [ ] The per-card status select is no longer a visible control **and the
      keyboard can still move a task** — it is the only non-mouse way to, so it
      is hidden until focus rather than deleted.
- [ ] A rule sits between a card's tags and its footer.
- [ ] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**Calendar is not in this task.** It needs `tasks.due_date`, which does not
exist; a tab leading to an empty screen is worse than no tab (§5.1 forbids the
placeholder). It arrives with the endpoint.

**The filters are ours, not the design's.** The reference's top bar carries
only `Priority: all` because that prototype had one filter. Ours has four, and
they go where the design puts filters — the top bar — rather than in a row the
design does not have.
