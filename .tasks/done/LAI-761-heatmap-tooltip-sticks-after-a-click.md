---
id: LAI-761
title: "The Activity heatmap's tooltip and outline stick after a day is clicked (server/web/)"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-17T07:03:38Z
status: done
finished: 2026-10-17T07:06:32Z
---

## Goal

**Made on the owner's direct instruction** (Pawan Sirsat, 2026-10-17, through
the orchestrator), single-agent mode, on the temporary branch `build-copy-fix`
beside LAI-760, and shipped with it in one push. Board card LAIKA-567. Changes
`server/web/` only. Not pushed, not merged: the orchestrator reviews and
merges.

On a member profile's Activity heatmap (`/people?user=…`), clicking a day
square left that day outlined and its tooltip open while the mouse moved to
other days or off the grid — the owner's screenshots show *Thu 25 Jun* and
*Tue 13 Oct* still open with the cursor elsewhere. The tooltip was driven by
focus as well as hover, a click focuses the cell, and only leaving the whole
card body hid it. When this is finished the tooltip follows the mouse for the
mouse and the focus for the keyboard, and a click pins nothing.

## Acceptance criteria

- [x] Mouse: the tooltip and the outline follow hover only. Moving to another
      day shows that day; leaving the grids hides both, even after a day was
      clicked. A click pins no tooltip and draws no focus outline (the cell's
      outline is `:focus-visible` only).
- [x] Keyboard: arrow keys still move between days and show the tooltip;
      Escape closes it; Tab out of the grid closes it.
- [x] The same in design A (split) and design B (stacked), over 12 weeks and
      over a year.
- [x] A browser test clicks a day, moves to another day (exactly one tooltip,
      for that day) and then off the grids (no tooltip, no outline), in both
      designs and both ranges, and covers the keyboard rules. It fails on the
      code before this change and passes after, shown once.
- [x] `pnpm test`, `pnpm lint` and `pnpm format` each exit 0 after the last
      edit.

## Notes / context

- SHELL's area (`server/web/src/routes/screens/profile/`). No new dependency.
- The heatmap is LAI-751's; its existing browser test is
  `server/web/test/browser/activity-heatmap.test.ts`.

## Done

- `a99b945f` — `server/web/src/routes/screens/profile/ActivityCard.tsx`: a
  cell's focus shows the tooltip only when it matches `:focus-visible`; a blur
  closes only its own day; `onMouseLeave` moved from `.hm-body` to each
  `.hm-grid`. The cell's outline was already `:focus-visible` only; the
  outline the owner saw was the hover ring, which now goes with the tooltip.
- Test: six new cases in `server/web/test/browser/activity-heatmap.test.ts`
  (*the tooltip after a click*). On the code before the fix the four mouse
  cases failed with *the tooltip stayed open off the grid* and the two
  keyboard cases passed (they guard the fix); after, all 20 in the file pass.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) after one Claude review (APPROVE, no blockers) and lint, format and web tests (1981/1981) passing on 54fb34f; merged to master on the owner's direct instruction.
