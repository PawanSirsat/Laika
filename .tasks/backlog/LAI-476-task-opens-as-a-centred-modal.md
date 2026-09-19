---
id: LAI-476
title: 'A task opens as a centred modal, not a right-hand drawer'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-285]
discovered-from:
status: backlog
---

## Goal

**Owner's request, with the shipped drawer beside a Jira issue modal:** *"when we
open the task that open from the right side but i want that like JIRA popup"*.

**Read D-063 first.** It amends D-059.2, departs from the design file
deliberately, and says which parts of the Jira screenshot are **not** in scope.

**This is a change of frame, not of content.** LAI-285 already made the drawer
two columns — a document beside a 288px rail — which is the same shape a Jira
issue modal has. What changes is the box around them.

| | now | after |
| --- | --- | --- |
| position | `fixed; top:0; right:0; bottom:0` | centred in the dimmed region |
| width | `min(1120px, 100%)` | a maximum, with a margin at every edge |
| height | the viewport, always | a maximum; the columns scroll inside it |
| edges | `border-left`, shadow cast leftward | border, radius and shadow on all sides |
| entrance | slides in from the right | appropriate to a centred box |

## Acceptance criteria — the frame

- [ ] **The panel is centred in the dimmed region and does not touch any edge.**
      Measured in a browser: the gaps above and below are equal, and so are left
      and right. **Not asserted as a CSS string.**
- [ ] **It is centred inside the scrimmed region, not the viewport** — the scrim
      still starts at `--rail-width` and **the sidebar stays usable with a task
      open**, which is LAI-252's deliberate property. Assert a space can still be
      switched while a task is open.
- [ ] **It has a maximum height and never exceeds the viewport.** Assert with a
      task whose description and comments are long enough to overflow, at **two
      viewport heights** — the header and its close button must be on screen in
      both.
- [ ] **Both columns scroll independently inside the frame**, and the page behind
      does not scroll while it is open. Assert the board's scroll position is
      unchanged after scrolling inside the modal.
- [ ] **Rounded, bordered and shadowed on all sides**, using the radius and
      surface tokens already in use. **No new tokens and no token value changes**
      (D-020).
- [ ] **On a narrow viewport it becomes near-full-screen** with a small inset,
      rather than a small box or a horizontally scrolling one.

## Acceptance criteria — the dialog semantics

These are **currently absent** and D-063 explains why a centred box makes them
obligatory. `TaskDrawer.tsx` today has no role, no modality, no label and no
trap.

- [ ] **`role="dialog"` and `aria-modal="true"`**, labelled by the task's key or
      title — asserted by reading the accessible name, not the attribute.
- [ ] **Focus is trapped inside the panel while it is open.** Tab from the last
      focusable element returns to the first, and Shift+Tab from the first wraps
      to the last. Assert by driving real key presses.
- [ ] **Focus returns to the card that opened it** on close — by Escape, by the
      scrim, and by the header's `×`. All three, asserted separately.
- [ ] **Nothing behind the modal is reachable by keyboard** while it is open.

## Acceptance criteria — nothing already working regresses

- [ ] **Escape, a scrim click and the header `×` all still close it**, and all
      three still strip `?task=` from the URL.
- [ ] **The `?task=` deep link still opens the modal on a cold load**, and the
      back button still closes it.
- [ ] **LAI-285's two columns are unchanged** — the document and the 288px rail,
      their contents and their order. This task reshapes the frame only.
- [ ] **Both themes**, including the scrim, the border and the shadow.
- [ ] **`prefers-reduced-motion` is honoured** by the new entrance, as the
      current one does.
- [ ] Full gate — repo root, all three `EXIT 0`, each captured on its own line.

## Notes / context

**`depends-on: [LAI-285]` and it is real.** LAI-285 built the two columns this
reshapes and **is sitting in `.tasks/review/`**, not `done/`. Do not start until
CHIEF has accepted it — and per CLAUDE.md §2, if CHIEF is holding it for a merge
and says by name that this may start, record the deviation here. **Do not infer
it from the file being in `review/`.**

**The files are `components/drawer/drawer.css` and
`components/drawer/TaskDrawer.tsx`.** The name `drawer` is now wrong; **renaming
it is allowed but not required** — if you do, do it completely and in its own
commit, so the reshaping diff stays readable.

**Out of scope, from the Jira screenshot** (D-063): the breadcrumb and epic link,
attachments, subtasks, the minimise control, and the `Details` disclosure
grouping. **Those are Jira's data model, not ours.** Build the frame; leave the
contents to LAI-285's shape.

**The design file disagrees with this task and that is expected.**
`docs/design/Laika 02-04 - Task, Capacity, Dashboard.dc.html` draws
`position:absolute; top:0; right:0; bottom:0; width:840px` — a right drawer.
**The owner has overridden it** (D-063). Do not "restore fidelity" here, and do
not treat the file as wrong either; it is a record of an earlier decision.

**SPEC §11.4.2's table is already updated** and no longer carries a width. You do
not need `docs/` and must not touch it.

**No new dependencies.** A focus-trap library is not pre-approved — if you think
one is warranted, write the task and say what it buys over the handlers already
there.
