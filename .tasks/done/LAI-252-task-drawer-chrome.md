---
id: LAI-252
title: 'The task drawer chrome: 840px over a dimmed board'
area: web
assignee: shell
priority: p1
depends-on: [LAI-251]
discovered-from: LAI-248
started: 2026-09-18T13:26:30+05:30
finished: 2026-09-18T13:36:47+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

> **Claim deviation, flagged (§2).** `depends-on` names LAI-251, in
> `.tasks/review/`. Same ground as the rest of Phase A: the owner-approved
> rebuild plan sequences these back-to-back on this branch.

## Goal

Phase A4 of the owner-approved prototype rebuild (2026-09-18). A task opens as
a **drawer over the dimmed board** (prototype lines ~360–367), not a side
panel: the board stays mounted underneath, scroll position and data intact.

- `src/components/drawer/TaskDrawerShell.tsx` + `drawer.css` — the chrome
  only: `width: min(840px, 100%)`, right-anchored over the content pane,
  scrim `rgba(15, 23, 42, .45)` (the sidebar stays interactive), `slidein
  .2s ease`, closed by scrim click, Escape, and the `×` button.
- Hosted by `SpaceLayout` on `?task=<id>`: opening pushes history so Back
  closes; closing strips the param.
- The **existing** `TaskDetailPanel` content renders inside unchanged — the
  drawer's content is LAI-248's plan Phase B4, not this task. `BoardScreen`
  stops owning the overlay.

## Acceptance criteria

- [x] At ≥ 900px viewport the drawer is 840px wide; below, full width. Scrim
      covers the content pane; the sidebar remains clickable.
- [x] Opening a card sets `?task=`, plays the slide-in, and the board behind
      keeps its scroll position through open and close (browser-tested).
- [x] Scrim click, Escape, and `×` each close it; browser Back closes it;
      Forward re-opens it.
- [x] The drawer works on every space view that lists tasks, not only the
      board (a row click on any view with task rows opens it).
- [x] `BoardScreen` no longer renders its own overlay; superseded overlay CSS
      is deleted in this task.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each with
      the drawer open.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

Keyframe `slidein` comes from LAI-251's `space/animations.css`
(`prefers-reduced-motion` guarded). An unpositioned scroll container cannot
clip absolutely-positioned descendants (the LAI-245 lesson) — the drawer is
`position: absolute` against the space layout's positioned content pane, so
the pane must be `position: relative`. No new dependencies.

## Completion notes

**Two design corrections, both measured rather than reasoned.**

1. **The drawer is `fixed`, not `absolute` in the space pane.** The prototype
   positions its overlay inside a content column that never scrolls; ours is a
   scrolling page. Measured on a page scrolled 400px: the drawer's top sat at
   **-400** with a height of 3861px, so a task opened below the fold had its
   key and close button above the viewport.
2. **The scrim had the same fault and my first fix silently missed it.** The
   edit that moved the drawer did not match the scrim's block, so it stayed
   anchored to the pane — dimming the board and leaving a bright band beneath
   it. **The drawer test passed anyway**, because it only asserted where the
   scrim *starts*: an absolute scrim satisfies "starts after the rail" just as
   well. Caught by looking at a screenshot, then pinned with assertions on the
   scrim's height and right edge.

`--rail-width` is the mechanism for keeping the design's other property — the
scrim dims the view and leaves the sidebar usable, so you can switch space with
a task open. The shell declares it beside the rail it describes (212px / 56px
collapsed / 0 below 900px, where the rail is off-canvas), and the overlay reads
it instead of guessing.

**Opening a task now pushes a history entry.** `setParams` gained a `push`
option: every other filter replaces, deliberately, so Back does not step
through each checkbox — but a drawer is a state the reader expects Back to
undo, and Forward to restore. Closing replaces, or Back from a closed drawer
would re-open it.

**`TaskDetailPanel` is content now.** Its own `position: fixed` shell, its
backdrop and its Escape handler moved to `TaskDrawer`; it keeps the `x` close
button, because the design draws that inside the header beside the key, and it
keeps its focus-restore effect, which is the better of the two. **Two overlays
for one drawer is how the geometry drifts apart.**

**The drawer's *content* is still the old panel** — that is Phase B4's task
(the design's Comments / Activity / Changes tabs and meta column). This task
was the chrome, and the AC said so.

**A note on how these notes were nearly mangled.** The first write of this
section went through an unquoted shell heredoc, which ate every backticked
term as a command substitution. Repaired in its own commit; the lesson is to
write task prose from a file or a quoted heredoc, never one that interpolates.

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

**Verified specifically.** The scrim dims the board and **leaves the sidebar at
full brightness and usable**, which is the property the task's own notes claim
and the reason it is `fixed` with `left: var(--rail-width)`. Escape and the
header `×` both close and both strip `?task=`.
