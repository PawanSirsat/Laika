---
id: LAI-425
title: The board's bands are in the wrong order, and so is the sidebar
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

**The owner says the UI does not feel like the design, and they are right about
structure.** Style matches — tokens are taken verbatim from
`docs/design/README.md` and `tokens.test.ts` proves it. What does not match is
**the order things appear in**, and order is most of what "feels like" means.

Measured, both rendered in the same browser at 1600×1100:

| | `docs/design/Laika Prototype.dc.html` | shipped |
| --- | --- | --- |
| vertical order | **sprint strip → board header → WORKING NOW → lanes** | **board header → sprint strip → WORKING NOW → lanes** |
| sidebar WORK | Board, **Timeline**, Calendar, Sprints, Capacity | Board, **Sprints**, Timeline, Projects |

The sprint strip is the first thing in the design and the second thing in ours.
That single inversion changes what the screen appears to be about: the design
opens with *which sprint am I in*, ours opens with *search and filters*.

## What is in scope

- [ ] **The sprint strip and its detail row sit above the board header**, as in
      the prototype. The header — project name, live pill, search, filters,
      view toggle, New task — comes after.
- [ ] **Sidebar WORK order is Board, Timeline, Sprints** — Timeline before
      Sprints, matching the design. `Projects` stays where it is (see Notes).
- [ ] Both themes, rendered in a real browser, compared against the prototype
      side by side at the same viewport.
- [ ] `nav-truth.test.ts` still passes, or is updated deliberately — it asserts
      the nav's **contents**; this task changes the **order**, so if it does not
      notice a reorder, say so and make it notice.
- [ ] Full gate green.

## What is deliberately NOT in scope

Four nav destinations in the prototype are absent from the shipped sidebar. None
is a fidelity defect and none should be added here:

| Absent | Why |
| --- | --- |
| **Calendar** | Blocked on a decision, not a dependency — SPEC §14 q10 is unanswered (LAI-217) |
| **Capacity** | M5. `GET /api/v1/capacity` does not exist |
| **Meeting review** | M6 |
| **Tokens** | The screen is not built — LAI-410, backlog. The route exists and is hidden |
| **`SYSTEM` group** (Login & invite, First boot, Projects) | **Deliberately dropped.** CLAUDE.md §5.1: *"It exists in the prototype so every screen is reachable in one file. Login, first boot and the project picker are pre-auth or org-level routes, not nav destinations."* |

**Do not add a nav entry for a screen that is not built.** Absent-not-disabled is
the rule LAI-082 settled.

## One thing to raise rather than match

The prototype's theme control is a single **`☾ Switch to dark`** button. Ours is
three radios — Light / Dark / **System**. Matching the prototype exactly would
**remove the System option**, which respects the reader's OS setting and which
the prototype simply does not offer.

**Do not change it under this task.** If the owner wants the prototype's toggle,
that is a deliberate trade of a real capability for visual fidelity and it needs
saying out loud, not doing quietly.

## Notes

No new dependencies. No new design tokens — this is layout order, not styling
(D-020).

`Projects` lives under WORK in ours and under `SYSTEM` in the prototype. Since
`SYSTEM` is not shipped, WORK is where it has to go; that is a consequence of an
existing decision, not a drift.
