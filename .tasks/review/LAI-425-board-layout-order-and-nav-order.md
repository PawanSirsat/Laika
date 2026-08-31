---
id: LAI-425
title: The board's bands are in the wrong order, and so is the sidebar
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-31T19:33:30Z
finished: 2026-09-01T01:45:00Z
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

- [x] **The sprint strip and its detail row sit above the board header**, as in
      the prototype. The header — project name, live pill, search, filters,
      view toggle, New task — comes after.
- [x] **Sidebar WORK order is Board, Timeline, Sprints** — Timeline before
      Sprints, matching the design. `Projects` stays where it is (see Notes).
- [x] Both themes, rendered in a real browser, compared against the prototype
      side by side at the same viewport.
- [x] `nav-truth.test.ts` still passes, or is updated deliberately — it asserts
      the nav's **contents**; this task changes the **order**, so if it does not
      notice a reorder, say so and make it notice.
- [x] Full gate green.

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

---

## Build note — SHELL, 2026-09-01

### I measured the prototype rather than trusting the table

Served `docs/design/` locally and read the band positions out of the prototype
itself at 1600×1100, then the same for ours:

| band | prototype | shipped, after |
| --- | --- | --- |
| sprint strip | `All sprints` y=10 | `.strip` y=0 |
| board header | `LIVE · SSE` y=134 | `.screen-bar` y=111 |
| WORKING NOW | y=192 | `.presence` y=172 |
| lanes | below | `.board-main` y=206 |

Same order. The task's table was right; it is now confirmed rather than
accepted.

**The prototype's sidebar, measured the same way:** Board(102), Timeline(134),
Calendar(166), Sprints(198), Capacity(230), Dashboard(288), Projects(533). With
Calendar and Capacity correctly out of scope, Board → Timeline → Sprints is what
remains, which is what shipped.

### `nav-truth.test.ts` did notice — and so did a second one

AC4 asked whether it would. It does: the label list is a `deepEqual`, so the
reorder failed it **before** I had finished the change. A second assertion in
`routes.test.ts` (`each group holds the right items, in order`) caught it too.
Both expectations were then edited deliberately, which is what those lines exist
for.

### The strip could not be seen at first, and that was the data

My dev instance had **no sprints**, so `SprintStrip` rendered nothing and the
board's children were header → presence → lanes. Read carelessly that looks like
the change failing. It was an empty project. Created two sprints and the strip
appeared, first.

Worth stating because it is the failure mode this task is about: *a screen that
is missing something can look identical to a screen that is broken.*

### Not done, deliberately

- **No nav entry** for Calendar, Capacity, Meeting review or Tokens, and no
  `SYSTEM` group. Absent-not-disabled (LAI-082, CLAUDE.md §5.1).
- **The theme control is untouched.** Matching the prototype's single
  `☾ Switch to dark` button would remove **System**, which respects the reader's
  OS setting. That is trading a real capability for visual fidelity and it is
  the owner's call, not mine.
- **No new tokens, no styling changes.** This is order only.

### A guard for the band order, which had none

`test/routes/screens/board-bands.test.ts` — source order, because `node --test`
cannot render a `.tsx` and so cannot read a computed `y` (that gap is LAI-227).
It fails if the two are swapped back, and pins the other two bands so a future
reorder cannot fix one pair by breaking another.

### Two mutations, two reds

Header before strip (1 fail), Sprints before Timeline (2 fails, in both nav
guards). Baseline confirmed green first; anchors asserted before mutating.
