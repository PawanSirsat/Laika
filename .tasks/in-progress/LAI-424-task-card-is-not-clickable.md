---
id: LAI-424
title: A task card is not clickable — only the small key inside it is
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T18:54:18Z
---

## Goal

**Found by the owner, using the board.** Their words: *"im not able click on the
sprint also not on the task"*.

Measured in a real browser against a seeded board:

| click target | result |
| --- | --- |
| the card's **title** (`p.card-title`) | **nothing happens** |
| anywhere else on the card (`article.card`) | **nothing happens** |
| the small monospace key, `LAI-16` (`button.card-key`) | panel opens |

The only interactive element inside a card is:

```
BUTTON.card-key :: "LAI-16 — open details"
```

`article.card` is not a button, carries no click handler, and gives no hover
affordance that the title is inert. So the whole card looks clickable — it is a
raised rectangle with a title, tags, an avatar and a priority dot — and the one
thing that works is a ~50px monospace link that reads as a label rather than a
control.

**Every board a person has used opens a task by clicking the card.** This is the
single most-used interaction on the screen and it is the one that does nothing.

The accessible name is already right (`"LAI-16 — open details"`), so the
intent exists; it is the hit area that is wrong.

## Related, found at the same time

**The open task is not in the URL.** After the panel opens the address stays
`/board?project=laika-core` — no `?task=`. So a task cannot be linked to, a
refresh loses it, and back does not close it. That is the same shape as LAI-423:
state the user can see that the URL does not carry. Fix it here if it is cheap;
if it is not, file it rather than leaving it unsaid.

## Acceptance criteria

- [ ] **Clicking anywhere on a task card opens its detail panel** — title, tags,
      whitespace. Not only the key.
- [ ] It stays **one** control to assistive technology. Do not nest a button
      inside a button, and do not put a click handler on a `div` — the existing
      `button.card-key` accessible name is `"LAI-16 — open details"` and whatever
      lands must keep an equivalent name.
- [ ] The controls **already inside** the card keep working and do not open the
      panel when used: the `+` add-to-sprint control, the assignee avatar, and
      the blocker link. A click on those must not also trigger the card.
- [ ] The card shows it is interactive — a cursor and a hover state, in **both
      themes**, using existing design tokens. If none fits, stop and file
      (D-020).
- [ ] Keyboard: the card is reachable by Tab and opens on Enter/Space, once.
- [ ] `?task=` in the URL, or a filed task saying why not.
- [ ] A test clicks the **card body**, not the key, and asserts the panel opens.
      **Make it fail first** — today it passes only because nothing tries.
- [ ] Rendered in a real browser, both themes. Full gate green.

## Notes

No new dependencies.

**The sprint chips are fine and are not part of this.** Measured: clicking
`Sprint 13 — Agent access` filters the board (visible task keys went 2 → 1) and
adds `&sprint=<id>` to the URL. The owner reported them together because from
the outside "I clicked and the page did not open something" looks like one
problem. It is worth knowing that the chip's feedback is a **filter**, which is
subtle enough to read as nothing happening — if that is worth a stronger active
state, file it separately rather than widening this.
